// A video card (feed grid, channel shelf, related rail) and the lazy thumbnail loader.

import { Keymap } from "obsidian";
import type SlopTube from "../main";
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
	return el;
}

/** True when a click should open in a new tab (mod-click or middle-click). */
export function wantsNewTab(evt: MouseEvent): boolean {
	return evt.button === 1 || Keymap.isModEvent(evt) !== false;
}
