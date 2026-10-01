// The watch page: thumbnail banner, clickbait title, channel row, the note rendered in
// reading view, and an "up next" rail that slides in when the mouse nears the bottom edge.

import { Component, ItemView, MarkdownRenderer, Menu, Platform, ViewStateResult, WorkspaceLeaf, getFrontMatterInfo, setIcon } from "obsidian";
import type SlopTube from "../main";
import type { NoteCard } from "../model";
import { relatedCards } from "../related";
import { formatAge, formatViews, hash } from "../util";
import { BaitEditModal } from "./BaitModal";
import { ThumbLoader, channelAvatar, drawThumb, renderCard, renderRetention, wantsNewTab } from "./card";

export const VIEW_WATCH = "sloptube-watch";

const RAIL_HIDE_DELAY = 350;

export class WatchView extends ItemView {
	override navigation = true;
	private path: string | null = null;
	/** Owns the rendered markdown's children; replaced on every navigation. */
	private page: Component | null = null;
	private rail: HTMLElement | null = null;
	private railLoader: ThumbLoader | null = null;
	private hideTimer: number | null = null;
	/** The current render's "javítás folyamatban" label; mirrors the plugin's run state. */
	private proseStatus: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: SlopTube) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_WATCH;
	}
	getDisplayText(): string {
		const card = this.card();
		return card ? `▶ ${card.title}` : "SlopTube";
	}
	override getIcon(): string {
		return "tv";
	}

	override getState(): Record<string, unknown> {
		return { path: this.path };
	}

	override async setState(state: { path?: string }, result: ViewStateResult): Promise<void> {
		if (state.path && state.path !== this.path) {
			this.path = state.path;
			result.history = true;
			await this.render();
		}
		await super.setState(state, result);
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("sloptube", "st-watch");
		this.containerEl.addClass("st-watch-container");
		this.registerDomEvent(this.containerEl, "mousemove", (evt) => this.onMouseMove(evt));
		this.registerDomEvent(this.containerEl, "mouseleave", () => this.scheduleHide());
		this.registerDomEvent(this.contentEl, "click", (evt) => this.onLinkClick(evt), { capture: true });
	}

	override async onClose(): Promise<void> {
		this.clearPage();
	}

	private card(): NoteCard | undefined {
		return this.path ? this.plugin.model.byPath.get(this.path) : undefined;
	}

	private clearPage(): void {
		if (this.page) this.removeChild(this.page);
		this.page = null;
		this.proseStatus = null;
		this.railLoader?.disconnect();
		this.railLoader = null;
		this.rail?.remove();
		this.rail = null;
	}

	async render(): Promise<void> {
		this.clearPage();
		const el = this.contentEl;
		el.empty();
		el.scrollTop = 0;
		const card = this.card();
		if (!card) {
			el.createDiv({ cls: "st-empty", text: this.plugin.model.cards.length ? "Ez a videó nem érhető el." : "Indexelés…" });
			return;
		}
		this.page = this.addChild(new Component());
		const { plugin } = this;
		const bait = plugin.bait.get(card);
		const channel = plugin.model.channel(card.subject);
		const col = el.createDiv({ cls: "st-watch-col" });

		const nav = col.createDiv({ cls: "st-watch-nav" });
		const home = nav.createEl("button", { text: "SlopTube" });
		setIcon(home.createSpan({ cls: "st-btn-icon" }), "home");
		home.onclick = () => void plugin.openFeed(this.leaf);

		drawThumb(col.createDiv({ cls: "st-thumb st-player" }), plugin, card);
		col.createEl("h1", { cls: "st-watch-title", text: bait.title });

		const row = col.createDiv({ cls: "st-watch-channel" });
		channelAvatar(row, plugin, card.subject);
		const who = row.createDiv({ cls: "st-watch-who" });
		const name = who.createDiv({ cls: "st-channel-name", text: card.subject });
		if (card.verified) name.createSpan({ cls: "st-verified", text: " ✔" });
		who.createDiv({ cls: "st-stats", text: [card.section, `${channel?.cards.length ?? 0} videó`].filter(Boolean).join(" • ") });
		renderRetention(who, plugin.keptSeries(card.subject));
		const hub = channel?.hub;
		if (hub && hub !== card) {
			name.addClass("is-link");
			name.onclick = (evt) => void plugin.openWatch(hub.path, wantsNewTab(evt) ? "tab" : this.leaf);
		}
		const edit = row.createEl("button", { cls: "st-open-note mod-cta", text: "Eredeti jegyzet" });
		edit.onclick = (evt) => void (wantsNewTab(evt) ? plugin.app.workspace.getLeaf("tab") : this.leaf).openFile(card.file);
		this.buildMoreMenu(row, card);

		const desc = col.createDiv({ cls: "st-description" });
		desc.createDiv({ cls: "st-stats", text: [formatViews(card.backlinks.length, hash(card.path)), formatAge(card.updated)].filter(Boolean).join(" • ") });
		// The title is the question, the hook its answer: hide the answer until asked for,
		// unless the gate is off or the note was already graded today.
		const gated = plugin.settings.recallGate && !plugin.recall.gradedToday(card.path);
		const gate = gated ? desc.createDiv({ cls: "st-gate" }) : null;
		const answer = desc.createDiv({ cls: "st-answer" });
		if (bait.hook) answer.createDiv({ cls: "st-hook", text: bait.hook });
		const grade = answer.createDiv({ cls: "st-grade" });
		this.renderGrade(grade, card);
		if (gate) this.renderGate(gate, answer, grade, bait.hook !== null);
		const note = answer.createDiv({ cls: "st-note markdown-rendered" });
		// Not cachedRead: the Claude CLI may have just rewritten the note outside Obsidian.
		const text = await plugin.app.vault.read(card.file);
		if (this.card() !== card) return; // navigated away while reading
		await MarkdownRenderer.render(plugin.app, text.slice(getFrontMatterInfo(text).contentStart), note, card.path, this.page);

		this.buildRail(card);
	}

	/** "Megvan a tippem — mutasd" reveals the answer; "Csak nézem" reveals it without grading. */
	private renderGate(gate: HTMLElement, answer: HTMLElement, grade: HTMLElement, hasHook: boolean): void {
		answer.hide();
		gate.createDiv({ cls: "st-gate-prompt", text: hasHook ? "Mi a válasz? Tippelj, mielőtt megnézed." : "Mit tudsz erről? Gondold végig, mielőtt megnézed." });
		const actions = gate.createDiv({ cls: "st-gate-actions" });
		const reveal = actions.createEl("button", { cls: "mod-cta st-gate-reveal", text: "Megvan a tippem — mutasd" });
		const skip = actions.createEl("button", { cls: "st-gate-skip", text: "Csak nézem" });
		reveal.onclick = () => {
			gate.remove();
			answer.show();
		};
		skip.onclick = () => {
			gate.remove();
			grade.hide();
			answer.show();
		};
	}

	/** "Tudtad?" with two grades; after grading, the chosen one stays marked and can be changed today. */
	private renderGrade(el: HTMLElement, card: NoteCard): void {
		el.empty();
		const today = this.plugin.recall.gradedToday(card.path);
		el.createSpan({ cls: "st-grade-q", text: today ? "✔ Rögzítve" : "Tudtad?" });
		const button = (g: 0 | 1, label: string) => {
			const b = el.createEl("button", { text: label });
			if (today?.g === g) b.addClass("is-active");
			b.onclick = () => {
				this.plugin.grade(card, g);
				this.renderGrade(el, card);
			};
		};
		button(1, "Tudtam");
		button(0, "Nem tudtam");
	}

	/**
	 * A quiet "⋯" menu next to "Eredeti jegyzet": edit the card's title, and (desktop only)
	 * run the improve-prose skill on the note.
	 */
	private buildMoreMenu(row: HTMLElement, card: NoteCard): void {
		const more = row.createEl("button", { cls: "st-more clickable-icon", attr: { "aria-label": "Továbbiak" } });
		setIcon(more, "more-horizontal");
		more.onclick = (evt) => {
			const menu = new Menu();
			menu.addItem((i) => i.setTitle("Cím szerkesztése").setIcon("pencil").onClick(() => this.editBait(card)));
			if (Platform.isDesktopApp) {
				const busy = this.plugin.prose.isRunning(card.path);
				menu.addItem((i) =>
					i
						.setTitle(busy ? "Javítás folyamatban…" : "Próza javítása")
						.setIcon("wand-2")
						.setDisabled(busy)
						.onClick(() => void this.plugin.improveProse(card)),
				);
			}
			menu.showAtMouseEvent(evt);
		};
		this.proseStatus = row.createSpan({ cls: "st-prose-busy", text: "Próza javítása folyamatban…" });
		this.syncProseButton();
	}

	private editBait(card: NoteCard): void {
		new BaitEditModal(this.app, this.plugin.bait.get(card), async (edit) => {
			await this.plugin.bait.set(card.path, edit);
			this.plugin.refreshViews();
		}).open();
	}

	/** Shows a running improve-prose job next to the menu until it ends. */
	syncProseButton(): void {
		const card = this.card();
		if (!this.proseStatus || !card) return;
		this.proseStatus.toggle(this.plugin.prose.isRunning(card.path));
	}

	private buildRail(card: NoteCard): void {
		const rail = this.containerEl.createDiv({ cls: "sloptube st-rail" });
		rail.createDiv({ cls: "st-rail-title", text: "Következő" });
		const row = rail.createDiv({ cls: "st-rail-row" });
		this.railLoader = new ThumbLoader(row);
		for (const next of relatedCards(card, this.plugin.model, this.plugin.settings.railSize)) {
			renderCard(row, this.plugin, next, this.railLoader, (c, evt) => void this.plugin.openWatch(c.path, wantsNewTab(evt) ? "tab" : this.leaf));
		}
		this.rail = rail;
	}

	private onMouseMove(evt: MouseEvent): void {
		if (!this.rail) return;
		const bottom = this.containerEl.getBoundingClientRect().bottom;
		const overRail = this.rail.contains(evt.target as Node);
		if (overRail || evt.clientY > bottom - this.plugin.settings.railThreshold) {
			if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
			this.hideTimer = null;
			this.rail.addClass("is-shown");
		} else {
			this.scheduleHide();
		}
	}

	private scheduleHide(): void {
		if (!this.rail?.hasClass("is-shown") || this.hideTimer !== null) return;
		this.hideTimer = window.setTimeout(() => {
			this.rail?.removeClass("is-shown");
			this.hideTimer = null;
		}, RAIL_HIDE_DELAY);
	}

	/** Wikilinks to in-scope notes keep playing in SlopTube; everything else opens normally. */
	private onLinkClick(evt: MouseEvent): void {
		const a = (evt.target as HTMLElement).closest("a.internal-link");
		const card = this.card();
		if (!a || !card) return;
		evt.preventDefault();
		evt.stopPropagation();
		const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
		const dest = this.plugin.app.metadataCache.getFirstLinkpathDest(href.split("#")[0], card.path);
		const newTab = wantsNewTab(evt);
		if (dest && this.plugin.model.byPath.has(dest.path)) void this.plugin.openWatch(dest.path, newTab ? "tab" : this.leaf);
		else void this.plugin.app.workspace.openLinkText(href, card.path, newTab);
	}
}
