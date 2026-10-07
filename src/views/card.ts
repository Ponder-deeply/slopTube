// A video card (feed grid, channel shelf, related rail) and the lazy thumbnail loader.

import { Keymap } from "obsidian";
import type SlopTube from "../main";
import type { Retention } from "../main";
import type { NoteCard } from "../model";
import { renderThumb } from "../thumb";
import { formatAge, formatDuration, formatViews, hash } from "../util";

/** Renders thumbnails only once their card scrolls near the viewport. */
export class ThumbLoader {
	private pending = new Map<Element, () => void>();
	private observer: IntersectionObserver;

	constructor(root: HTMLElement | null) {
		this.observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					this.pending.get(e.target)?.();
					this.pending.delete(e.target);
					this.observer.unobserve(e.target);
				}
			},
			{ root, rootMargin: "400px" },
		);
	}

	add(el: HTMLElement, draw: () => void): void {
		this.pending.set(el, draw);
		this.observer.observe(el);
	}

	disconnect(): void {
		this.observer.disconnect();
		this.pending.clear();
	}
}

export function channelAvatar(parent: HTMLElement, plugin: SlopTube, subject: string): HTMLElement {
	const el = parent.createDiv({ cls: "st-avatar", text: subject.slice(0, 2).toUpperCase() });
	el.style.backgroundColor = `oklch(0.62 0.16 ${plugin.model.hue(subject)})`;
	return el;
}

/** Fills `el` with a card's thumbnail (art, duration, badges); shared by cards and the watch banner. */
export function drawThumb(el: HTMLElement, plugin: SlopTube, card: NoteCard): void {
	const bait = plugin.bait.get(card);
	renderThumb(el, {
		seed: card.path,
		hue: plugin.model.hue(card.subject),
		channel: card.subject,
		section: card.section,
		title: card.title,
		hasMath: card.hasMath,
		hasCode: card.hasCode,
		text: bait.thumbText,
	});
	el.createSpan({ cls: "st-duration", text: formatDuration(card.words) });
	if (card.isHub) el.createSpan({ cls: "st-badge", text: "CSATORNA" });
	if (plugin.isGolden(card)) el.createSpan({ cls: "st-badge-due", text: plugin.recall.hasHistory(card.path) ? "★ ESEDÉKES" : "★ ÚJ" });
}

export function renderCard(
	parent: HTMLElement,
	plugin: SlopTube,
	card: NoteCard,
	loader: ThumbLoader,
	onOpen: (card: NoteCard, evt: MouseEvent) => void,
): HTMLElement {
	const bait = plugin.bait.get(card);
	const el = parent.createDiv({ cls: "st-card" });
	el.toggleClass("is-golden", plugin.isGolden(card));

	const thumb = el.createDiv({ cls: "st-thumb" });
	loader.add(thumb, () => drawThumb(thumb, plugin, card));

	const meta = el.createDiv({ cls: "st-meta" });
	channelAvatar(meta, plugin, card.subject);
	const info = meta.createDiv({ cls: "st-info" });
	info.createDiv({ cls: "st-title", text: bait.title, attr: { title: card.title } });
	const ch = info.createDiv({ cls: "st-channel", text: card.subject });
	if (card.verified) ch.createSpan({ cls: "st-verified", text: " ✔", attr: { title: "derivation: source" } });
	const age = formatAge(card.updated);
	info.createDiv({ cls: "st-stats", text: [formatViews(card.backlinks.length, hash(card.path)), age].filter(Boolean).join(" • ") });

	el.addEventListener("click", (evt) => onOpen(card, evt));
	el.addEventListener("auxclick", (evt) => {
		if (evt.button === 1) onOpen(card, evt);
	});
	el.tabIndex = 0;
	el.addEventListener("keydown", (evt) => {
		if (evt.key !== "Enter") return;
		evt.preventDefault();
		onOpen(card, new MouseEvent("click", { ctrlKey: evt.ctrlKey, metaKey: evt.metaKey }));
	});
	return el;
}

/**
 * A subject's retention: a bar over all its notes (kept / studied but faded / not studied yet),
 * its two main figures, and, once something is studied, a 30-day sparkline of how well the
 * studied notes are remembered (red when the last week fell more than 5 points).
 */
export function renderRetention(parent: HTMLElement, { series, kept, studied }: Retention): HTMLElement {
	const el = parent.createDiv({ cls: "st-retention" });
	if (series.length) {
		const W = 60, H = 16;
		const pt = (v: number, i: number) => `${((i / (series.length - 1)) * W).toFixed(1)},${(H - 1 - (v / 100) * (H - 2)).toFixed(1)}`;
		const svg = el.createSvg("svg", { cls: "st-spark", attr: { viewBox: `0 0 ${W} ${H}`, width: W, height: H } });
		svg.createSvg("polyline", { attr: { points: series.map(pt).join(" ") } });
		const week = series.slice(-8);
		if (week[0] - week[week.length - 1] > 5) {
			svg.createSvg("polyline", { cls: "is-falling", attr: { points: week.map((v, i) => pt(v, series.length - 8 + i)).join(" ") } });
		}
		svg.createSvg("title").textContent = "A tanult jegyzetek átlagos felidézési esélye, az elmúlt 30 napban";
	}
	const keptPct = Math.round(kept);
	const known = Math.max(keptPct, Math.round(studied));
	const bar = el.createDiv({ cls: "st-share" });
	bar.createDiv({ cls: "st-share-kept" }).style.width = `${keptPct}%`;
	bar.createDiv({ cls: "st-share-faded" }).style.width = `${known - keptPct}%`;
	el.createSpan({ text: `megtartva ${keptPct}% · tanult ${known}%` });
	el.setAttr("aria-label", `A csatorna jegyzeteiből ${keptPct}% megtartva, ${known - keptPct}% tanult de elhalványult, ${100 - known}% még nem tanult`);
	return el;
}

/** True when a click should open in a new tab (mod-click or middle-click). */
export function wantsNewTab(evt: MouseEvent): boolean {
	return evt.button === 1 || Keymap.isModEvent(evt) !== false;
}
