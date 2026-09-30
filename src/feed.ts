// Feed ordering: chip filters, the seeded weighted shuffle, and shelf sorting.

import type { NoteCard, VaultModel } from "./model";
import type { SlopSettings } from "./settings";
import { rng } from "./util";

/** "all" | "active" | "recent" | "s:<subject>" — a plain string so it serializes into view state. */
export type Chip = string;
export type SortMode = "newest" | "views" | "az";

const RECENT_DAYS = 14;

export function chipMatches(chip: Chip, card: NoteCard, model: VaultModel): boolean {
	if (chip === "all") return true;
	if (chip === "active") return model.activeSubjects.has(card.subject);
	if (chip === "recent") {
		const t = card.updated ? Date.parse(card.updated) : NaN;
		return !Number.isNaN(t) && Date.now() - t < RECENT_DAYS * 86_400_000;
	}
	return chip === `s:${card.subject}`;
}

export function randomWeight(card: NoteCard, model: VaultModel, s: SlopSettings): number {
	const base = s.subjectWeights[card.subject] ?? 1;
	return model.activeSubjects.has(card.subject) ? base * s.activeBoost : base;
}

/**
 * Weighted shuffle without replacement (Efraimidis–Spirakis): each card gets key u^(1/w),
 * highest keys first. Zero-weight cards are dropped. Same seed, same order.
 */
export function weightedShuffle(cards: NoteCard[], weight: (c: NoteCard) => number, seed: number): NoteCard[] {
	const r = rng(seed);
	return cards
		.map((c) => ({ c, w: weight(c) }))
		.filter(({ w }) => w > 0)
		.map(({ c, w }) => ({ c, k: Math.pow(r(), 1 / w) }))
		.sort((a, b) => b.k - a.k)
		.map(({ c }) => c);
}

export function sortCards(cards: NoteCard[], mode: SortMode): NoteCard[] {
	const out = [...cards];
	if (mode === "newest") out.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
	else if (mode === "views") out.sort((a, b) => b.backlinks.length - a.backlinks.length);
	else out.sort((a, b) => a.title.localeCompare(b.title, "hu"));
	return out;
}
