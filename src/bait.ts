// Clickbait for cards: baked entries from bait.json, template fallback for the rest.

import type { DataAdapter } from "obsidian";
import type { NoteCard } from "./model";
import { hash, pick, rng } from "./util";

export interface BaitEntry {
	title: string;
	/** 1–3 words drawn in block letters on the thumbnail. */
	thumbText: string;
	/** Optional one-liner under the title on the watch page. */
	hook?: string;
	/** The format the bake used (story, impossible, …); kept for rotating formats in later bakes. */
	format?: string;
}

export interface Bait {
	title: string;
	thumbText: string;
	hook: string | null;
	baked: boolean;
}

// {t} = note title, {h} = a section heading. Built so {t} never needs a Hungarian suffix.
const TEMPLATES = [
	"{t}: ezt senki nem mondta el 😱",
	"{t} — ELMAGYARÁZVA (végre érthetően)",
	"A tanár ezt kihagyta… | {t}",
	"{t} — 90% ELRONTJA a vizsgán",
	"Megpróbáltam megérteni: {t} (24 óra) 🤯",
	"{t} 5 perc alatt (vizsgára kész)",
	"{t} vs. a valóság 💀",
	"Miért nem beszél SENKI erről? {t}",
	"NE tanuld meg ezt, amíg nem láttad: {t}",
	"{t} — a teljes igazság 🔥",
];
const HEADING_TEMPLATES = ["„{h}” — ezt NEM fogod elhinni | {t}", "{h}?! 🤯 | {t}"];

const MAX_THUMB_WORD = 12;

export class BaitStore {
	private entries: Record<string, BaitEntry> = {};
	private adapter: DataAdapter | null = null;
	private path = "";

	async load(adapter: DataAdapter, pluginDir: string): Promise<void> {
		this.adapter = adapter;
		this.path = `${pluginDir}/bait.json`;
		if (!(await adapter.exists(this.path))) return;
		try {
			this.entries = JSON.parse(await adapter.read(this.path));
		} catch (e) {
			console.error("[sloptube] bait.json is not valid JSON", e);
		}
	}

	get(card: NoteCard): Bait {
		const e = this.entries[card.path];
		if (e) return { title: e.title, thumbText: e.thumbText, hook: e.hook ?? null, baked: true };
		return { ...fallback(card), hook: null, baked: false };
	}

	/** Replaces a card's bait (hand edits) and writes bait.json in the same layout merge-bait uses. */
	async set(path: string, edit: Omit<BaitEntry, "format">): Promise<void> {
		const entry: BaitEntry = { ...this.entries[path], ...edit };
		if (!entry.hook) delete entry.hook;
		this.entries[path] = entry;
		await this.adapter?.write(this.path, JSON.stringify(this.entries, null, 1) + "\n");
	}
}

function fallback(card: NoteCard): { title: string; thumbText: string } {
	const r = rng(hash(card.path) ^ 0x5eed);
	const t = card.title;
	const useHeading = card.headings.length > 0 && r() < 0.3;
	const template = useHeading ? pick(HEADING_TEMPLATES, r) : pick(TEMPLATES, r);
	const title = template.replace("{t}", t).replace("{h}", useHeading ? pick(card.headings, r) : "");

	// Thumbnail text: the longest word of the title that fits the block font, else the first word.
	const words = t.split(/[\s—–\-:,()]+/).filter((w) => w.length > 1);
	const fits = words.filter((w) => w.length <= MAX_THUMB_WORD);
	const thumbText = (fits.sort((a, b) => b.length - a.length)[0] ?? words[0] ?? t).slice(0, MAX_THUMB_WORD);
	return { title, thumbText };
}
