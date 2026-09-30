// The note model: every in-scope wiki page as a NoteCard, built from metadataCache only.

import { App, TFile, TFolder } from "obsidian";

const CONCEPTS = "Wiki/concepts/";
const SUBJECTS = "Wiki/subjects/";
const SEMESTERS = "Egyetem";
/** Rough bytes per word for Hungarian UTF-8 prose; duration needs no file read. */
const BYTES_PER_WORD = 7;

export interface NoteCard {
	file: TFile;
	path: string;
	/** Channel id: the subject folder name. */
	subject: string;
	isHub: boolean;
	title: string;
	updated: string | null;
	/** `derivation: source` — every claim traces to a vault file. */
	verified: boolean;
	words: number;
	hasMath: boolean;
	hasCode: boolean;
	headings: string[];
	/** Where the note sits in its subject: the hub heading it is listed under. */
	section: string | null;
	outlinks: string[];
	backlinks: string[];
}

/** A hub heading and the notes listed under it, in the hub's order (a lecture, for courses). */
export interface Section {
	/** The heading as the hub writes it, e.g. "3. előadás — Folytonosság, kompaktság". */
	heading: string;
	cards: NoteCard[];
}

export interface Channel {
	/** The subject folder name; also the channel's display name. */
	id: string;
	/** Base hue (OKLCH degrees), evenly spaced across channels so each reads as its own color. */
	hue: number;
	hub: NoteCard | null;
	cards: NoteCard[];
	/** Hub sections in hub order, then "Egyéb" for notes the hub does not list. */
	sections: Section[];
}

function subjectOf(path: string): { subject: string; isHub: boolean } | null {
	if (path.startsWith(CONCEPTS)) {
		const subject = path.slice(CONCEPTS.length).split("/")[0];
		return path.slice(CONCEPTS.length).includes("/") ? { subject, isHub: false } : null;
	}
	if (path.startsWith(SUBJECTS) && !path.slice(SUBJECTS.length).includes("/")) {
		return { subject: path.slice(SUBJECTS.length, -".md".length), isHub: true };
	}
	return null;
}

/** Hub headings that group nothing topical. */
const GENERIC_HEADINGS = new Set(["Fogalomlapok", "Kapocs", "Tartalom", "Tárgykör", "Témakörök", "Tematika", "Szintézis", "A tárgy célja"]);

/**
 * A hub heading reduced to its topic: "12–13. előadás — Alkalmazási réteg" → "Alkalmazási réteg",
 * "V. Kötelmi jog" → "Kötelmi jog", "LU-felbontás (3. előadás)" → "LU-felbontás".
 */
function topicOf(heading: string): string {
	const parts = heading.split(/\s+[—–]\s+/);
	const topic = parts.length > 1 && /előadás/i.test(parts[0]) ? parts.slice(1).join(" — ") : heading;
	return topic
		.replace(/^(?:[IVX]+|\d+)\.\s+/, "")
		.replace(/\s*\([^)]*előadás[^)]*\)\s*$/i, "")
		.trim();
}

function gcd(a: number, b: number): number {
	return b ? gcd(b, a % b) : a;
}

function romanValue(name: string): number {
	const s = name.toLowerCase();
	const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50 };
	let total = 0;
	for (let i = 0; i < s.length; i++) {
		const cur = v[s[i]], next = v[s[i + 1]] ?? 0;
		if (cur === undefined) return 0;
		total += cur < next ? -cur : cur;
	}
	return total;
}

export class VaultModel {
	cards: NoteCard[] = [];
	byPath = new Map<string, NoteCard>();
	channels: Channel[] = [];
	/** Subjects with a course folder in the active semester (same rule as gen_state.py). */
	activeSubjects = new Set<string>();

	constructor(private app: App) {}

	rebuild(): void {
		const { metadataCache } = this.app;
		const cards: NoteCard[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const where = subjectOf(file.path);
			if (!where) continue;
			const cache = metadataCache.getFileCache(file);
			const fm = cache?.frontmatter ?? {};
			const h1 = cache?.headings?.find((h) => h.level === 1)?.heading;
			const sections = cache?.sections ?? [];
			cards.push({
				file,
				path: file.path,
				subject: where.subject,
				isHub: where.isHub,
				title: h1 ?? file.basename,
				updated: typeof fm.updated === "string" ? fm.updated : null,
				verified: fm.derivation === "source",
				words: Math.round(file.stat.size / BYTES_PER_WORD),
				hasMath: sections.some((s) => s.type === "math"),
				hasCode: sections.some((s) => s.type === "code"),
				headings: (cache?.headings ?? []).filter((h) => h.level > 1).map((h) => h.heading),
				section: null,
				outlinks: [],
				backlinks: [],
			});
		}
		this.byPath = new Map(cards.map((c) => [c.path, c]));

		for (const [src, dests] of Object.entries(metadataCache.resolvedLinks)) {
			const from = this.byPath.get(src);
			if (!from) continue;
			for (const dest of Object.keys(dests)) {
				const to = this.byPath.get(dest);
				if (!to || to === from) continue;
				from.outlinks.push(dest);
				to.backlinks.push(src);
			}
		}

		this.cards = cards;
		this.channels = this.buildChannels(cards);
		for (const ch of this.channels) this.assignSections(ch);
		this.activeSubjects = this.findActiveSubjects();
	}

	channel(id: string): Channel | undefined {
		return this.channels.find((c) => c.id === id);
	}

	hue(subject: string): number {
		return this.channel(subject)?.hue ?? 0;
	}

	private buildChannels(cards: NoteCard[]): Channel[] {
		const map = new Map<string, Channel>();
		for (const card of cards) {
			let ch = map.get(card.subject);
			if (!ch) map.set(card.subject, (ch = { id: card.subject, hue: 0, hub: null, cards: [], sections: [] }));
			if (card.isHub) ch.hub = card;
			ch.cards.push(card);
		}
		const channels = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
		// Even hue slots, visited with a stride coprime to n so alphabetical neighbours
		// (analii, analiii) land far apart on the wheel.
		const n = channels.length;
		let stride = Math.max(1, Math.round(n * 0.382));
		while (gcd(stride, n) !== 1) stride++;
		channels.forEach((ch, i) => (ch.hue = Math.round(((i * stride) % n) * (360 / n) + 15) % 360));
		return channels;
	}

	/**
	 * Each note linked from the hub gets the nearest non-generic heading above its first link;
	 * the channel's sections keep the hub's order of headings and of links within them.
	 */
	private assignSections(ch: Channel): void {
		const hub = ch.hub;
		const bySection = new Map<string, Section>();
		const listed = new Set<NoteCard>();
		if (hub) {
			const { metadataCache } = this.app;
			const cache = metadataCache.getFileCache(hub.file);
			const headings = (cache?.headings ?? []).filter((h) => h.level >= 2 && !GENERIC_HEADINGS.has(h.heading.trim()));
			for (const link of cache?.links ?? []) {
				const dest = metadataCache.getFirstLinkpathDest(link.link.split("#")[0], hub.path);
				const card = dest && this.byPath.get(dest.path);
				if (!card || listed.has(card) || card.subject !== hub.subject || card.isHub) continue;
				const line = link.position.start.line;
				const heading = headings.filter((h) => h.position.start.line < line).pop();
				if (!heading) continue;
				listed.add(card);
				card.section = topicOf(heading.heading);
				let section = bySection.get(heading.heading);
				if (!section) bySection.set(heading.heading, (section = { heading: heading.heading, cards: [] }));
				section.cards.push(card);
			}
		}
		const rest = ch.cards.filter((c) => !c.isHub && !listed.has(c));
		ch.sections = [...bySection.values()];
		if (rest.length) ch.sections.push({ heading: "Egyéb", cards: rest });
	}

	private findActiveSubjects(): Set<string> {
		const root = this.app.vault.getAbstractFileByPath(SEMESTERS);
		if (!(root instanceof TFolder)) return new Set();
		const semesters = root.children
			.filter((f): f is TFolder => f instanceof TFolder && romanValue(f.name) > 0)
			.sort((a, b) => romanValue(b.name) - romanValue(a.name));
		const active = semesters[0];
		if (!active) return new Set();
		const courses = active.children.filter((f) => f instanceof TFolder).map((f) => f.name);
		return new Set(courses.filter((c) => this.channels.some((ch) => ch.id === c)));
	}
}
