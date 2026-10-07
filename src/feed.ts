// Feed ordering: chip filters, the seeded weighted shuffle, and shelf sorting.

import type { NoteCard, VaultModel } from "./model";
import type { RecallStore } from "./recall";
import type { SlopSettings } from "./settings";
import { rng } from "./util";

/** "all" | "active" | "due" | "recent" | "s:<subject>" — a plain string so it serializes into view state. */
export type Chip = string;
export type SortMode = "newest" | "views" | "az";

const RECENT_DAYS = 14;
/** Weight multiplier for a note already graded today, so the feed does not repeat it. */
const FRESH_DAMPING = 0.3;

export function chipMatches(chip: Chip, card: NoteCard, model: VaultModel, recall: RecallStore, now = Date.now()): boolean {
	if (chip === "all") return true;
	if (chip === "active") return model.activeSubjects.has(card.subject);
	if (chip === "due") return recall.overdue(card, now) > 0;
	if (chip === "recent") {
		const t = card.updated ? Date.parse(card.updated) : NaN;
		return !Number.isNaN(t) && Date.now() - t < RECENT_DAYS * 86_400_000;
	}
	return chip === `s:${card.subject}`;
}

/** Overdue (and studied but never graded) notes surface more (up to 1 + overdueBoost times), today's recalls sink. */
export function recallFactor(card: NoteCard, recall: RecallStore, s: SlopSettings, now = Date.now()): number {
	const fresh = recall.touchedToday(card.path, now) ? FRESH_DAMPING : 1;
	return (1 + s.overdueBoost * recall.overdue(card, now)) * fresh;
}

export function randomWeight(card: NoteCard, model: VaultModel, s: SlopSettings, recall: RecallStore, now = Date.now()): number {
	const base = s.subjectWeights[card.subject] ?? 1;
	const subject = model.activeSubjects.has(card.subject) ? base * s.activeBoost : base;
	return subject * recallFactor(card, recall, s, now);
}

/** Most overdue first. */
export function sortByOverdue(cards: NoteCard[], recall: RecallStore, now = Date.now()): NoteCard[] {
	const score = new Map(cards.map((c) => [c, recall.overdue(c, now)]));
	return [...cards].sort((a, b) => score.get(b)! - score.get(a)!);
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
