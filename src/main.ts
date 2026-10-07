// SlopTube: browse the wiki as a YouTube-style feed.
// Goal: passive review of the active semester's exam subjects (see the plan / README).

import { FileSystemAdapter, Notice, Plugin, TFile, WorkspaceLeaf, debounce, normalizePath } from "obsidian";
import { BaitStore } from "./bait";
import { ProseRunner } from "./claude";
import { randomWeight, weightedShuffle } from "./feed";
import { DAY, type Streak, dayKey, kept, keptSeries, streak } from "./memory";
import { type NoteCard, VaultModel, gateIdsOf, topicOf } from "./model";
import { decorateNewTabs, undecorateNewTabs } from "./newtab";
import { type OwlContext, owlLine } from "./owl";
import { RecallStore } from "./recall";
import { DEFAULT_SETTINGS, SlopSettingTab, SlopSettings } from "./settings";
import { ConfirmModal, NameModal } from "./views/ConfirmModal";
import { FeedView, VIEW_FEED } from "./views/FeedView";
import { VIEW_WATCH, WatchView } from "./views/WatchView";

/** See `SlopTube.retention`. */
export interface Retention {
	/** 30-day series (today last) of the mean recall probability of the subject's studied notes, 0–100. */
	series: number[];
	/** Percent of all the subject's notes that are kept (studied and still remembered). */
	kept: number;
	/** Percent of all the subject's notes that are studied. */
	studied: number;
}

export default class SlopTube extends Plugin {
	override settings: SlopSettings = DEFAULT_SETTINGS;
	model = new VaultModel(this.app);
	bait = new BaitStore();
	prose = new ProseRunner();
	recall = new RecallStore();
	/** Subject → its retention figures, valid for one local day and until the next grade. */
	private keptCache = new Map<string, { day: string; series: number[]; kept: number }>();

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.applyLayout();
		this.register(() => {
			document.body.style.removeProperty("--st-card-w");
			document.body.style.removeProperty("--st-watch-w");
			document.body.style.removeProperty("--st-font-scale");
		});
		const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		await this.bait.load(this.app.vault.adapter, pluginDir);
		await this.recall.load(this.app.vault.adapter, pluginDir);
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.recall.rename(oldPath, file.path)));

		this.registerView(VIEW_FEED, (leaf) => new FeedView(leaf, this));
		this.registerView(VIEW_WATCH, (leaf) => new WatchView(leaf, this));

		this.addRibbonIcon("tv", "SlopTube", () => void this.openFeed());
		this.addCommand({ id: "open-feed", name: "Open feed", callback: () => void this.openFeed() });
		this.addCommand({
			id: "watch-current",
			name: "Watch current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.model.byPath.has(file.path)) return false;
				if (!checking) void this.openWatch(file.path, this.app.workspace.getLeaf(false));
				return true;
			},
		});
		this.addCommand({
			id: "toggle-studied",
			name: "Toggle studied on current note",
			checkCallback: (checking) => {
				const card = this.activeCard();
				if (!card || card.isHub) return false;
				if (!checking) void this.setStudied(card, !card.studied);
				return true;
			},
		});
		this.addCommand({
			id: "mark-subject-studied",
			name: "Mark all notes of the current subject studied",
			checkCallback: (checking) => {
				const card = this.activeCard();
				if (!card) return false;
				if (!checking) this.markSubjectStudied(card.subject);
				return true;
			},
		});
		this.addCommand({ id: "random-video", name: "Random video", callback: () => this.randomVideo() });
		// Both events: an empty tab can refill its action list after the layout change fired.
		this.registerEvent(this.app.workspace.on("layout-change", () => decorateNewTabs(this)));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => decorateNewTabs(this)));
		this.register(undecorateNewTabs);
		this.addSettingTab(new SlopSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.rebuildModel();
			decorateNewTabs(this);
			this.registerEvent(this.app.metadataCache.on("resolved", debounce(() => this.rebuildModel(), 1000, true)));
		});
	}

	override onunload(): void {
		void this.recall.flush();
	}

	/** Rebuilds the note model. Open views re-render only if they were showing an empty model. */
	private rebuildModel(): void {
		const wasEmpty = this.model.cards.length === 0;
		this.model.rebuild();
		this.keptCache.clear();
		this.recall.invalidate();
		if (this.model.cards.some((c) => c.gates.length)) this.recall.backfill((path) => this.model.byPath.get(path)?.gates ?? []);
		if (!wasEmpty) return;
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_FEED)) (leaf.view as FeedView).render();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_WATCH)) void (leaf.view as WatchView).render();
	}

	/** Layout sizes are body-level CSS variables, so every open view follows the settings live. */
	applyLayout(): void {
		document.body.style.setProperty("--st-card-w", `${this.settings.cardWidth}px`);
		document.body.style.setProperty("--st-watch-w", `${this.settings.watchWidth}px`);
		document.body.style.setProperty("--st-font-scale", `${this.settings.fontScale / 100}`);
	}

	/** Opens Obsidian's settings on this plugin's tab (`app.setting` is not in the public API). */
	openSettings(): void {
		const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(this.manifest.id);
	}

	async openFeed(leaf?: WorkspaceLeaf): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_FEED)[0];
		if (!leaf && existing) return this.app.workspace.revealLeaf(existing);
		await (leaf ?? this.app.workspace.getLeaf("tab")).setViewState({ type: VIEW_FEED, active: true });
	}

	async openWatch(path: string, where: WorkspaceLeaf | "tab"): Promise<void> {
		const leaf = where === "tab" ? this.app.workspace.getLeaf("tab") : where;
		await leaf.setViewState({ type: VIEW_WATCH, state: { path }, active: true });
	}

	/**
	 * Runs the improve-prose skill on a note. Every watch view showing the note follows the run,
	 * including ones opened on it later; on success they re-render with the rewritten text.
	 */
	async improveProse(card: NoteCard): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (this.prose.isRunning(card.path) || !(adapter instanceof FileSystemAdapter)) return;
		const run = this.prose.run(card.path, this.settings.claudePath, adapter.getBasePath());
		this.watchViewsOf(card.path).forEach((v) => v.syncProseButton());
		new Notice(`Próza javítása elindult: ${card.title}`);
		const result = await run;
		new Notice(`${result.ok ? "Próza javítva" : "Próza javítása sikertelen"}: ${card.title}\n\n${result.message}`, result.ok ? 15_000 : 0);
		for (const v of this.watchViewsOf(card.path)) {
			if (result.ok) void v.render();
			else v.syncProseButton();
		}
	}

	/** Re-renders every open feed and watch view, e.g. after a card's bait was edited by hand. */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_FEED)) (leaf.view as FeedView).refresh();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_WATCH)) void (leaf.view as WatchView).render();
	}

	private watchViewsOf(path: string): WatchView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_WATCH)
			.map((leaf) => leaf.view)
			.filter((v): v is WatchView => v instanceof WatchView && v.getState().path === path);
	}

	/** Plays a weighted-random note, in `leaf` or else the active one. */
	randomVideo(leaf?: WorkspaceLeaf): void {
		const now = Date.now();
		const [card] = weightedShuffle(this.model.cards, (c) => randomWeight(c, this.model, this.settings, this.recall, now), now);
		if (!card) return void new Notice("SlopTube: nincs videó.");
		void this.openWatch(card.path, leaf ?? this.app.workspace.getLeaf(false));
	}

	// ---------- Habit loop ----------

	/** Credits a day: goalPerSubject for each active-semester subject (at least one). */
	dailyGoal(): number {
		return this.settings.goalPerSubject * Math.max(1, this.model.activeSubjects.size);
	}

	streak(now = Date.now()): Streak {
		return streak(this.recall.daily(), this.recall.goals, this.dailyGoal(), dayKey(now));
	}

	/** Golden = a studied note with a gate that is due: never graded, or graded and now overdue. */
	isGolden(card: NoteCard, now = Date.now()): boolean {
		return this.recall.overdue(card, now) > 0;
	}

	/**
	 * A subject's retention, two ways. Against all its notes (hubs aside): `studied` and `kept`,
	 * so what is studied but faded is the gap and the rest is not studied yet. Among the studied
	 * notes only: the 30-day `series`, which an unstudied backlog would otherwise flatten, so a
	 * real decline shows (the owl watches it). Every note weighs the same whatever its gate count.
	 */
	retention(subject: string, now = Date.now()): Retention {
		const day = dayKey(now);
		const cards = (this.model.channel(subject)?.cards ?? []).filter((c) => !c.isHub);
		const studiedCards = cards.filter((c) => c.studied);
		const studied = cards.length ? (100 * studiedCards.length) / cards.length : 0;
		let hit = this.keptCache.get(subject);
		if (hit?.day !== day) {
			const histories = (list: NoteCard[]) => list.map((c) => c.gates.map((gate) => this.recall.events(c.path, gate)));
			const series = studiedCards.length ? keptSeries(histories(studiedCards), now) : [];
			const keptAll = kept(histories(cards), now);
			this.keptCache.set(subject, (hit = { day, series, kept: keptAll }));
		}
		return { series: hit.series, kept: hit.kept, studied };
	}

	/** Logs a graded gate recall and updates every feed's streak and owl. */
	grade(card: NoteCard, gate: string, g: 0 | 1): void {
		const before = this.streak();
		this.recall.grade(card.path, gate, g, this.dailyGoal(), card.gates);
		this.keptCache.delete(card.subject);
		const after = this.streak();
		if (before.today < before.goal && after.today >= after.goal) new Notice("Mai adag kész. A Minisztérium elégedett.");
		this.refreshHabit();
	}

	/**
	 * Asks for a name, then opens a new note by it in a new tab, in the subject's course folder
	 * (newest semester). An existing note of that name is opened as it is, never overwritten.
	 */
	writeReflection(subject: string, lecture: string): void {
		const folder = this.model.courseFolder(subject);
		if (!folder) return void new Notice(`SlopTube: nincs Egyetem/…/${subject} mappa.`);
		new NameModal(this.app, "Reflexió írása", `Reflexió — ${topicOf(lecture)}`, async (raw) => {
			const name = raw.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
			if (!name) return void new Notice("SlopTube: a jegyzetnek nevet kell adni.");
			const path = normalizePath(`${folder}/${name}.md`);
			let file = this.app.vault.getAbstractFileByPath(path);
			if (file && !(file instanceof TFile)) return void new Notice(`SlopTube: ${path} nem jegyzet.`);
			if (!file) file = await this.app.vault.create(path, `---\nreflection: ${JSON.stringify(lecture)}\n---\n# ${name}\n\n${this.lectureQuery(subject, lecture)}`);
			else new Notice("SlopTube: ez a jegyzet már létezik, megnyitom.");
			const note = file as TFile;
			// The new note lists on its lecture's shelf once the metadata cache has read its front matter.
			const ref = this.app.metadataCache.on("changed", (f) => {
				if (f.path !== note.path) return;
				this.app.metadataCache.offref(ref);
				this.refreshViews();
			});
			await this.app.workspace.getLeaf("tab").openFile(note);
		}).open();
	}

	/**
	 * A Dataview block listing the wiki pages the subject's hub links under a lecture heading. It
	 * is a query, not a copied list, so it follows the hub as the lecture's pages change.
	 */
	private lectureQuery(subject: string, lecture: string): string {
		const hub = this.model.channel(subject)?.hub;
		if (!hub) return "";
		const str = (v: string) => `"${v.replace(/[\\"]/g, "\\$&")}"`;
		return [
			"```dataview",
			"LIST WITHOUT ID L.outlinks[0]",
			'FROM "Wiki/subjects"',
			"FLATTEN file.lists AS L",
			`WHERE file.path = ${str(hub.path)} AND meta(L.section).subpath = ${str(lecture)} AND length(L.outlinks) > 0`,
			"```",
			"",
			"",
		].join("\n");
	}

	/** Marks a note studied (gated, tracked) or not, in its front matter. */
	async setStudied(card: NoteCard, studied: boolean): Promise<void> {
		await this.writeStudied(card, studied);
		this.afterStudiedChange();
	}

	/** Marks every note of a subject (hub aside) studied, after the user confirms. */
	markSubjectStudied(subject: string): void {
		const cards = (this.model.channel(subject)?.cards ?? []).filter((c) => !c.isHub && !c.studied);
		if (!cards.length) return void new Notice(`SlopTube: a(z) ${subject} minden jegyzete már tanult.`);
		new ConfirmModal(this.app, `${cards.length} jegyzet tanultnak jelölése`, `A(z) ${subject} ${cards.length} jegyzetének frontmatterébe studied: true kerül.`, async () => {
			for (const card of cards) await this.writeStudied(card, true);
			this.afterStudiedChange();
			new Notice(`SlopTube: ${cards.length} jegyzet tanultnak jelölve (${subject}).`);
		}).open();
	}

	private async writeStudied(card: NoteCard, studied: boolean): Promise<void> {
		await this.app.fileManager.processFrontMatter(card.file, (fm: Record<string, unknown>) => {
			if (studied) fm.studied = true;
			else delete fm.studied;
		});
		// The metadata cache lags the write; the next rebuild recomputes the same values.
		card.studied = studied;
		card.gates = studied ? this.gatesOf(card) : [];
	}

	private afterStudiedChange(): void {
		this.keptCache.clear();
		this.recall.invalidate();
		this.refreshViews();
	}

	/** The note on screen: the watch page's, else the active markdown file's. */
	private activeCard(): NoteCard | undefined {
		const view = this.app.workspace.getActiveViewOfType(WatchView);
		const path = view ? (view.getState().path as string | null) : this.app.workspace.getActiveFile()?.path;
		return path ? this.model.byPath.get(path) : undefined;
	}

	private gatesOf(card: NoteCard): string[] {
		const cache = this.app.metadataCache.getFileCache(card.file);
		return gateIdsOf(cache);
	}

	owlLine(now = Date.now()): string | null {
		if (!this.settings.owl) return null;
		let longOverdue: NoteCard | null = null;
		let oldestDue = now - 7 * DAY;
		for (const card of this.model.cards) {
			const due = this.recall.nextDue(card.path);
			if (due !== null && due < oldestDue) {
				oldestDue = due;
				longOverdue = card;
			}
		}
		const fading = [...this.model.activeSubjects].find((subject) => {
			const series = this.retention(subject, now).series;
			return series.length > 8 && series[series.length - 8] - series[series.length - 1] > 10;
		});
		const ctx: OwlContext = {
			streak: this.streak(now),
			hour: new Date(now).getHours(),
			longOverdue: longOverdue?.title ?? null,
			fading: fading ?? null,
		};
		return owlLine(ctx);
	}

	/** Re-renders the streak and owl in every open feed, without touching its cards. */
	refreshHabit(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_FEED)) (leaf.view as FeedView).renderHabit();
	}

	async loadSettings(): Promise<void> {
		const data: Partial<SlopSettings> | null = await this.loadData();
		this.settings = { ...DEFAULT_SETTINGS, ...data, subjectWeights: { ...data?.subjectWeights } };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
