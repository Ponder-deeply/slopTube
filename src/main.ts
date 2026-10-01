// SlopTube: browse the wiki as a YouTube-style feed.
// Goal: passive review of the active semester's exam subjects (see the plan / README).

import { FileSystemAdapter, Notice, Plugin, WorkspaceLeaf, debounce } from "obsidian";
import { BaitStore } from "./bait";
import { ProseRunner } from "./claude";
import { randomWeight, weightedShuffle } from "./feed";
import { type NoteCard, VaultModel } from "./model";
import { decorateNewTabs, undecorateNewTabs } from "./newtab";
import { DEFAULT_SETTINGS, SlopSettingTab, SlopSettings } from "./settings";
import { FeedView, VIEW_FEED } from "./views/FeedView";
import { VIEW_WATCH, WatchView } from "./views/WatchView";

export default class SlopTube extends Plugin {
	override settings: SlopSettings = DEFAULT_SETTINGS;
	model = new VaultModel(this.app);
	bait = new BaitStore();
	prose = new ProseRunner();

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.applyLayout();
		this.register(() => {
			document.body.style.removeProperty("--st-card-w");
			document.body.style.removeProperty("--st-watch-w");
			document.body.style.removeProperty("--st-font-scale");
		});
		await this.bait.load(this.app.vault.adapter, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);

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

	/** Rebuilds the note model. Open views re-render only if they were showing an empty model. */
	private rebuildModel(): void {
		const wasEmpty = this.model.cards.length === 0;
		this.model.rebuild();
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
		const [card] = weightedShuffle(this.model.cards, (c) => randomWeight(c, this.model, this.settings), Date.now());
		if (!card) return void new Notice("SlopTube: nincs videó.");
		void this.openWatch(card.path, leaf ?? this.app.workspace.getLeaf(false));
	}

	async loadSettings(): Promise<void> {
		const data: Partial<SlopSettings> | null = await this.loadData();
		this.settings = { ...DEFAULT_SETTINGS, ...data, subjectWeights: { ...data?.subjectWeights } };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
