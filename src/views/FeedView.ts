// The home page: a random ("Ajánlott") grid with endless scroll, channel shelves ("Csatornák"),
// or each channel's hub sections in hub order ("Előadások").

import { ItemView, ViewStateResult, WorkspaceLeaf, setIcon } from "obsidian";
import { Chip, SortMode, chipMatches, randomWeight, recallFactor, sortByOverdue, sortCards, weightedShuffle } from "../feed";
import type SlopTube from "../main";
import { type Channel, type NoteCard, lectureNumber, topicOf } from "../model";
import { addLayoutSettings } from "../settings";
import { ThumbLoader, channelAvatar, renderCard, renderRetention, wantsNewTab } from "./card";

export const VIEW_FEED = "sloptube-feed";

const PAGE = 24;
/** At most this many golden cards per page, so the feed never turns into a wall of gold. */
const GOLD_PER_PAGE = 6;

type Mode = "random" | "channels" | "lectures";

interface FeedState {
	mode: Mode;
	chip: Chip;
	seed: number;
	sort: SortMode;
	/** Pages rendered and scroll offset, so navigating back lands where you left. */
	pages: number;
	scroll: number;
}

export class FeedView extends ItemView {
	override navigation = true;
	private state: FeedState = { mode: "random", chip: "all", seed: Date.now(), sort: "newest", pages: 1, scroll: 0 };
	private loader: ThumbLoader | null = null;
	private pager: IntersectionObserver | null = null;
	/** The header's "⋯" view-settings panel; closed by any click outside it. */
	private viewPanel: HTMLElement | null = null;
	/** The header's streak widget and the owl's line; re-rendered in place after a grade. */
	private streakEl: HTMLElement | null = null;
	private owlEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: SlopTube) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_FEED;
	}
	getDisplayText(): string {
		return "SlopTube";
	}
	override getIcon(): string {
		return "tv";
	}

	override getState(): Record<string, unknown> {
		return { ...this.state, scroll: this.contentEl.scrollTop };
	}

	override async setState(state: Partial<FeedState>, result: ViewStateResult): Promise<void> {
		this.state = { ...this.state, ...state };
		this.render();
		await super.setState(state, result);
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("sloptube", "st-feed");
		this.registerDomEvent(document, "click", (evt) => {
			if (this.viewPanel?.isShown() && !this.viewPanel.contains(evt.target as Node)) this.viewPanel.hide();
		});
		this.render();
	}

	override async onClose(): Promise<void> {
		this.teardown();
	}

	private teardown(): void {
		this.loader?.disconnect();
		this.pager?.disconnect();
		this.loader = this.pager = null;
	}

	private update(patch: Partial<FeedState>): void {
		this.state = { ...this.state, pages: 1, scroll: 0, ...patch };
		this.render();
	}

	/** Re-renders in place, keeping the scroll position (used after hand edits). */
	refresh(): void {
		this.state.scroll = this.contentEl.scrollTop;
		this.render();
	}

	render(): void {
		this.teardown();
		const el = this.contentEl;
		el.empty();
		this.loader = new ThumbLoader(el);
		this.renderHeader(el.createDiv({ cls: "st-header" }));
		this.renderChips(el.createDiv({ cls: "st-chips" }));
		this.owlEl = el.createDiv({ cls: "st-owl" });
		this.renderHabit();
		const body = el.createDiv({ cls: "st-body" });
		if (this.plugin.model.cards.length === 0) body.createDiv({ cls: "st-empty", text: "Indexelés… (a vault még töltődik)" });
		else if (this.state.mode === "random") this.renderRandom(body);
		else if (this.state.mode === "lectures") this.renderLectures(body);
		else this.renderChannels(body);
		el.scrollTop = this.state.scroll;
	}

	private renderHeader(h: HTMLElement): void {
		const logo = h.createDiv({ cls: "st-logo" });
		setIcon(logo.createSpan({ cls: "st-logo-icon" }), "play");
		logo.createSpan({ text: "SlopTube" });
		this.streakEl = h.createDiv({ cls: "st-streak" });

		const tabs = h.createDiv({ cls: "st-tabs" });
		const tab = (mode: Mode, label: string) => {
			const b = tabs.createEl("button", { text: label });
			if (this.state.mode === mode) b.addClass("is-active");
			b.onclick = () => this.update({ mode });
		};
		tab("random", "Ajánlott");
		tab("channels", "Csatornák");
		tab("lectures", "Előadások");

		const tools = h.createDiv({ cls: "st-tools" });
		if (this.state.mode === "random") {
			const b = tools.createEl("button", { attr: { "aria-label": "Újrakeverés" } });
			setIcon(b, "shuffle");
			b.onclick = () => this.update({ seed: Date.now() });
		} else if (this.state.mode === "channels") {
			const sel = tools.createEl("select", { cls: "dropdown" });
			for (const [v, label] of [["newest", "Legújabb"], ["views", "Legnézettebb"], ["az", "A–Z"]] as const)
				sel.createEl("option", { value: v, text: label });
			sel.value = this.state.sort;
			sel.onchange = () => this.update({ sort: sel.value as SortMode });
		}

		const more = tools.createEl("button", { cls: "st-more clickable-icon", attr: { "aria-label": "Nézet beállításai" } });
		setIcon(more, "more-horizontal");
		const panel = h.createDiv({ cls: "st-view-panel" });
		panel.hide();
		addLayoutSettings(panel, this.plugin);
		const all = panel.createEl("button", { cls: "st-panel-link", text: "Összes beállítás…" });
		all.onclick = () => this.plugin.openSettings();
		more.onclick = (evt) => {
			evt.stopPropagation();
			panel.toggle(!panel.isShown());
		};
		this.viewPanel = panel;
	}

	private renderChips(row: HTMLElement): void {
		const chip = (id: Chip, label: string) => {
			const b = row.createEl("button", { cls: "st-chip", text: label });
			if (this.state.chip === id) b.addClass("is-active");
			b.onclick = () => this.update({ chip: id });
		};
		chip("all", "Mind");
		if (this.plugin.model.activeSubjects.size) chip("active", "Aktív félév");
		chip("due", "Esedékes");
		chip("recent", "Legújabb");
		for (const ch of this.plugin.model.channels) chip(`s:${ch.id}`, ch.id);
	}

	private filtered(cards: NoteCard[]): NoteCard[] {
		const now = Date.now();
		return cards.filter((c) => chipMatches(this.state.chip, c, this.plugin.model, this.plugin.recall, now));
	}

	/** Streak flame, today's credits against the goal, and the owl's line. */
	renderHabit(): void {
		const { streakEl, owlEl, plugin } = this;
		if (!streakEl || !owlEl) return;
		const st = plugin.streak();
		const met = st.today >= st.goal;
		streakEl.empty();
		streakEl.toggleClass("is-met", met);
		streakEl.setAttr("aria-label", `Sorozat: ${st.current} nap (legjobb: ${st.best}). Ma: ${st.today}/${st.goal} kredit.`);
		streakEl.createSpan({ cls: "st-flame", text: "🔥" });
		streakEl.createSpan({ cls: "st-streak-n", text: String(st.current) });
		const ring = streakEl.createSvg("svg", { cls: "st-ring", attr: { viewBox: "0 0 20 20", width: 16, height: 16 } });
		const r = 8, len = 2 * Math.PI * r;
		ring.createSvg("circle", { cls: "st-ring-track", attr: { cx: 10, cy: 10, r } });
		ring.createSvg("circle", {
			cls: "st-ring-fill",
			attr: { cx: 10, cy: 10, r, "stroke-dasharray": `${len * Math.min(1, st.today / st.goal)} ${len}`, transform: "rotate(-90 10 10)" },
		});
		streakEl.createSpan({ cls: "st-streak-today", text: `${st.today}/${st.goal}` });

		const line = plugin.owlLine();
		owlEl.toggle(line !== null);
		owlEl.setText(line ? `🦉 ${line}` : "");
	}

	private renderRandom(body: HTMLElement): void {
		const { model, settings, recall } = this.plugin;
		const now = Date.now();
		const pool = this.filtered(model.cards);
		// An explicit channel chip shows that channel even if its feed weight is 0.
		const weight = this.state.chip.startsWith("s:")
			? (c: NoteCard) => recallFactor(c, recall, settings, now)
			: (c: NoteCard) => randomWeight(c, model, settings, recall, now);
		// Due: a finite review queue, most overdue first, no endless shuffle; feed weights don't apply.
		if (this.state.chip === "due") {
			if (!pool.length) body.createDiv({ cls: "st-empty", text: "Semmi sem esedékes. Gyanús." });
			const grid = body.createDiv({ cls: "st-grid" });
			for (const card of sortByOverdue(pool, recall, now)) this.card(grid, card);
			return;
		}
		if (!pool.some((c) => weight(c) > 0)) {
			body.createDiv({ cls: "st-empty", text: "Nincs itt semmi. Még." });
			return;
		}
		const grid = body.createDiv({ cls: "st-grid" });
		const sentinel = body.createDiv({ cls: "st-sentinel" });

		// Endless: when a shuffle runs out, the next round reshuffles with a derived seed.
		let round = 0, queue: NoteCard[] = [], rendered = 0;
		const nextPage = () => {
			// A golden card past the page's cap goes to the back of the queue, unless only gold is left.
			let golden = 0, deferred = 0;
			for (let i = 0; i < PAGE; ) {
				if (!queue.length) queue = weightedShuffle(pool, weight, this.state.seed + round++);
				const card = queue.shift()!;
				const isGolden = this.plugin.isGolden(card, now);
				if (isGolden && golden >= GOLD_PER_PAGE && deferred < queue.length) {
					queue.push(card);
					deferred++;
					continue;
				}
				if (isGolden) golden++;
				this.card(grid, card);
				i++;
			}
			this.state.pages = ++rendered;
		};
		while (rendered < this.state.pages) nextPage();

		this.pager = new IntersectionObserver(
			(entries) => {
				if (!entries.some((e) => e.isIntersecting)) return;
				nextPage();
				// Re-observe: fires again if one page was not enough to push the sentinel out of range.
				this.pager?.unobserve(sentinel);
				this.pager?.observe(sentinel);
			},
			{ root: this.contentEl, rootMargin: "800px" },
		);
		this.pager.observe(sentinel);
	}

	private renderChannels(body: HTMLElement): void {
		const shelves = this.plugin.model.channels
			.map((ch) => ({ ch, cards: sortCards(this.filtered(ch.cards), this.state.sort) }))
			.filter(({ cards }) => cards.length > 0);
		const single = shelves.length === 1;
		for (const { ch, cards } of shelves) {
			const shelf = body.createDiv({ cls: "st-shelf" });
			this.renderShelfHeader(shelf.createDiv({ cls: "st-shelf-header" }), ch, cards.length);
			const row = shelf.createDiv({ cls: single ? "st-grid" : "st-shelf-row" });
			for (const card of cards) this.card(row, card);
		}
	}

	/** Per channel, one shelf per hub section, in the hub's order: a course reads lecture by lecture. */
	private renderLectures(body: HTMLElement): void {
		for (const ch of this.plugin.model.channels) {
			const sections = ch.sections.map((s) => ({ heading: s.heading, cards: this.filtered(s.cards) })).filter((s) => s.cards.length > 0);
			if (!sections.length) continue;
			const block = body.createDiv({ cls: "st-lecture-channel" });
			block.style.setProperty("--st-hue", String(ch.hue));
			this.renderShelfHeader(block.createDiv({ cls: "st-shelf-header" }), ch, sections.reduce((n, s) => n + s.cards.length, 0));
			for (const s of sections) {
				const shelf = block.createDiv({ cls: "st-shelf st-lecture" });
				const h = shelf.createDiv({ cls: "st-lecture-header" });
				const nr = lectureNumber(s.heading);
				if (nr) h.createSpan({ cls: "st-lecture-badge", text: `${nr}. EA` });
				h.createSpan({ cls: "st-lecture-name", text: nr ? topicOf(s.heading) : s.heading });
				if (nr) this.renderReflections(h, ch.id, s.heading);
				h.createSpan({ cls: "st-shelf-count", text: `${s.cards.length} videó` });
				const row = shelf.createDiv({ cls: "st-shelf-row" });
				for (const card of s.cards) this.card(row, card);
			}
		}
	}

	/** Next to a lecture's title: its reflections as numbered chips (the title shows on hover), and the button for a new one. */
	private renderReflections(h: HTMLElement, subject: string, lecture: string): void {
		const box = h.createSpan({ cls: "st-reflections" });
		this.plugin.model.reflections(subject, lecture).forEach((file, i) => {
			const chip = box.createEl("button", { cls: "st-reflection", text: String(i + 1), attr: { "aria-label": file.basename } });
			chip.onclick = () => void this.plugin.app.workspace.getLeaf("tab").openFile(file);
		});
		const write = box.createEl("button", { cls: "st-reflect", text: "Reflexió írása" });
		write.onclick = () => this.plugin.writeReflection(subject, lecture);
	}

	private renderShelfHeader(h: HTMLElement, ch: Channel, count: number): void {
		channelAvatar(h, this.plugin, ch.id);
		const name = h.createDiv({ cls: "st-shelf-name", text: ch.id });
		if (this.plugin.model.activeSubjects.has(ch.id)) h.createSpan({ cls: "st-live", text: "ÉLŐ" });
		h.createSpan({ cls: "st-shelf-count", text: `${count} videó` });
		renderRetention(h, this.plugin.retention(ch.id));
		const hub = ch.hub;
		if (hub) {
			name.addClass("is-link");
			name.onclick = (evt) => this.play(hub, evt);
		}
	}

	private card(parent: HTMLElement, card: NoteCard): void {
		renderCard(parent, this.plugin, card, this.loader!, (c, evt) => this.play(c, evt));
	}

	private play(card: NoteCard, evt: MouseEvent): void {
		void this.plugin.openWatch(card.path, wantsNewTab(evt) ? "tab" : this.leaf);
	}
}
