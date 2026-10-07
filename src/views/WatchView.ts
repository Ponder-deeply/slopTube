// The watch page: thumbnail banner, clickbait title, channel row, the note rendered in
// reading view, and an "up next" rail that slides in when the mouse nears the bottom edge.

import { Component, ItemView, MarkdownRenderer, Menu, Platform, ViewStateResult, WorkspaceLeaf, getFrontMatterInfo, setIcon } from "obsidian";
import type SlopTube from "../main";
import { BASE_GATE, type Segment, parseGates } from "../gates";
import { DUE_R, recallProb } from "../memory";
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
		renderRetention(who, plugin.retention(card.subject));
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
		this.renderStudyToggle(desc, card);
		const body = desc.createDiv({ cls: "st-answer" });
		// Not cachedRead: the Claude CLI may have just rewritten the note outside Obsidian.
		const text = await plugin.app.vault.read(card.file);
		if (this.card() !== card) return; // navigated away while reading
		const markdown = text.slice(getFrontMatterInfo(text).contentStart);
		// Only a studied note is gated; the title is its question and the hook the base gate's answer.
		const segments: Segment[] = card.studied ? parseGates(markdown) : [{ kind: "open", text: markdown }];
		const hasBase = segments.some((s) => s.kind === "gate" && s.id === BASE_GATE);
		if (bait.hook && !hasBase) body.createDiv({ cls: "st-hook", text: bait.hook });
		for (const seg of segments) {
			if (seg.kind === "open") {
				await this.renderMarkdown(body.createDiv({ cls: "st-note markdown-rendered" }), seg.text, card);
			} else {
				const hook = seg.id === BASE_GATE ? bait.hook : null;
				await this.renderGate(body.createDiv({ cls: "st-gate" }), card, seg, hook);
			}
			if (this.card() !== card) return;
		}

		this.buildRail(card);
	}

	private renderMarkdown(el: HTMLElement, text: string, card: NoteCard): Promise<void> {
		return MarkdownRenderer.render(this.plugin.app, text, el, card.path, this.page!);
	}

	/** The studied toggle: marking a note puts its summary and every Tartalom subheader behind a gate. */
	private renderStudyToggle(desc: HTMLElement, card: NoteCard): void {
		const button = desc.createEl("button", {
			cls: "st-study",
			text: card.studied ? "✔ Tanult — visszavonás" : "Megjelölöm tanultnak",
		});
		if (!card.studied) button.addClass("mod-cta");
		button.onclick = () => {
			button.disabled = true;
			void this.plugin.setStudied(card, !card.studied);
		};
	}

	/**
	 * One gate: label and a reveal button; revealing shows the text and asks whether it was known.
	 * A failure blocks the gate again for another try; only the day's first grade is logged.
	 * A gate already known today stays open.
	 */
	private async renderGate(el: HTMLElement, card: NoteCard, seg: Extract<Segment, { kind: "gate" }>, hook: string | null): Promise<void> {
		const { recall } = this.plugin;
		el.createDiv({ cls: "st-gate-label", text: seg.label });
		const actions = el.createDiv({ cls: "st-gate-actions" });
		const body = el.createDiv({ cls: "st-gate-body" });
		if (hook) body.createDiv({ cls: "st-hook", text: hook });
		await this.renderMarkdown(body.createDiv({ cls: "st-note markdown-rendered" }), seg.text, card);
		const grade = body.createDiv({ cls: "st-grade" });

		const block = () => {
			actions.empty();
			grade.empty();
			body.hide();
			const retry = recall.gradedToday(card.path, seg.id)?.g === 0;
			const reveal = actions.createEl("button", { cls: "mod-cta st-gate-reveal", text: retry ? "Még egyszer — mutasd" : "Megvan a tippem — mutasd" });
			reveal.onclick = () => {
				actions.empty();
				body.show();
				askGrade();
			};
		};
		const askGrade = () => {
			grade.empty();
			const retry = recall.gradedToday(card.path, seg.id) !== null;
			grade.createSpan({ cls: "st-grade-q", text: retry ? "Most már megy?" : "Tudtad?" });
			const know = grade.createEl("button", { text: "Tudtam" });
			const dunno = grade.createEl("button", { text: "Nem tudtam" });
			know.onclick = () => {
				this.plugin.grade(card, seg.id, 1);
				known();
			};
			dunno.onclick = () => {
				this.plugin.grade(card, seg.id, 0);
				block();
			};
		};
		const known = () => {
			grade.empty();
			grade.createSpan({ cls: "st-grade-q", text: "✔ Rögzítve" });
		};

		// Only due gates are blocked: one still fresh opens, ungradable, until it fades.
		const today = recall.gradedToday(card.path, seg.id);
		const m = recall.memory(card.path, seg.id);
		const r = m ? recallProb(m, Date.now()) : 0;
		if (today?.g === 1) {
			actions.empty();
			known();
		} else if (m && today?.g !== 0 && r >= DUE_R) {
			actions.empty();
			grade.createSpan({ cls: "st-grade-q", text: `Még friss — ${Math.round(100 * r)}%` });
		} else block();
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
			menu.addItem((i) =>
				i.setTitle(`A(z) ${card.subject} összes jegyzete tanult`).setIcon("graduation-cap").onClick(() => this.plugin.markSubjectStudied(card.subject)),
			);
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
