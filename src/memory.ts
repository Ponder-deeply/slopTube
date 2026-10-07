// The forgetting-curve model behind the habit loop: half-lives replayed from graded recalls,
// overdue scores, kept %, credits and streaks. Pure (no Obsidian imports), so it is unit-tested.

/** One graded recall: when, and whether the answer was known (1) or not (0). */
export interface RecallEvent {
	t: number;
	g: 0 | 1;
}

/** A note's memory state after replaying its events: half-life in days, time of the last recall. */
export interface Memory {
	s: number;
	last: number;
}

export const DAY = 86_400_000;
/** A note is due once its recall probability falls below this. */
export const DUE_R = 0.7;
const FIRST_S = { 1: 2, 0: 1 } as const;
const MIN_S = 1;
const MAX_S = 180;
/** Credits for a graded recall, and for one on a note that was overdue at the time. */
export const CREDIT = 1;
export const GOLD_CREDIT = 3;

/** Recall probability at `now`: R = 2^(−Δt/s), Δt in days since the last recall. */
export function recallProb(m: Memory, now: number): number {
	return Math.pow(2, -Math.max(0, now - m.last) / DAY / m.s);
}

/** Half-life after a graded recall; R is the recall probability at the moment of review. */
export function nextHalfLife(s: number, r: number, g: 0 | 1): number {
	return g === 1 ? Math.min(MAX_S, s * (1.8 + 2 * (1 - r))) : Math.max(MIN_S, 0.4 * s);
}

/** Folds events (oldest first) with `t <= until` into a memory state; null when there are none. */
export function replay(events: readonly RecallEvent[], until = Infinity): Memory | null {
	let m: Memory | null = null;
	for (const e of events) {
		if (e.t > until) break;
		m = step(m, e);
	}
	return m;
}

function step(m: Memory | null, e: RecallEvent): Memory {
	return m ? { s: nextHalfLife(m.s, recallProb(m, e.t), e.g), last: e.t } : { s: FIRST_S[e.g], last: e.t };
}

/** 0 for new or fresh notes, rising to 1 as R falls from DUE_R to 0. */
export function overdue(m: Memory | null, now: number): number {
	if (!m) return 0;
	return Math.min(1, Math.max(0, (DUE_R - recallProb(m, now)) / DUE_R));
}

/** When a note's recall probability crosses DUE_R. */
export function dueAt(m: Memory): number {
	return m.last + m.s * Math.log2(1 / DUE_R) * DAY;
}

/** One note's gate histories (an ungraded gate is an empty list). */
export type NoteHistory = readonly (readonly RecallEvent[])[];

/**
 * Kept %, 0–100: mean over a subject's notes of each note's retention. A note's retention is
 * the mean recall probability of its gates, ungraded gates counting 0, so every note weighs the
 * same however many gates it has.
 */
export function kept(notes: readonly NoteHistory[], now: number): number {
	if (!notes.length) return 0;
	let sum = 0;
	for (const gates of notes) {
		if (!gates.length) continue;
		let note = 0;
		for (const events of gates) {
			const m = replay(events, now);
			if (m) note += recallProb(m, now);
		}
		sum += note / gates.length;
	}
	return (100 * sum) / notes.length;
}

/** Kept % at the end of each of the last `days` local days, today last (evaluated at `now`). */
export function keptSeries(notes: readonly NoteHistory[], now: number, days = 30): number[] {
	const out: number[] = [];
	for (let i = days - 1; i >= 1; i--) out.push(kept(notes, endOfDay(now, -i)));
	out.push(kept(notes, now));
	return out;
}

/** Credits each event earned: GOLD_CREDIT when the gate was due just before it (a first grade always is). */
export function credits(events: readonly RecallEvent[]): number[] {
	let m: Memory | null = null;
	return events.map((e) => {
		const c = !m || overdue(m, e.t) > 0 ? GOLD_CREDIT : CREDIT;
		m = step(m, e);
		return c;
	});
}

// ---------- Local days ----------

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(t: number): string {
	const d = new Date(t);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The day key `offset` days from `key` (negative = earlier), by the local calendar. */
export function shiftDay(key: string, offset: number): string {
	const [y, m, d] = key.split("-").map(Number);
	return dayKey(new Date(y, m - 1, d + offset).getTime());
}

/** The last millisecond of the local day `offset` days from `t`'s day. */
export function endOfDay(t: number, offset = 0): number {
	const d = new Date(t);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset + 1).getTime() - 1;
}

// ---------- Streak ----------

export interface Streak {
	/** Consecutive days that met their goal, ending today (if met) or yesterday. */
	current: number;
	best: number;
	/** Credits earned today and today's goal. */
	today: number;
	goal: number;
	/** Length of the run that ended the day before yesterday, when yesterday broke it; else 0. */
	lost: number;
}

/**
 * `daily` = credits per local day; `goals` = the goal each past day had when it was earned
 * (days without one use `goal`, today's goal).
 */
export function streak(daily: ReadonlyMap<string, number>, goals: Readonly<Record<string, number>>, goal: number, today: string): Streak {
	const met = (k: string) => (daily.get(k) ?? 0) >= (k === today ? goal : (goals[k] ?? goal));
	const runEndingAt = (k: string) => {
		let n = 0;
		while (met(k)) {
			n++;
			k = shiftDay(k, -1);
		}
		return n;
	};
	const current = met(today) ? runEndingAt(today) : runEndingAt(shiftDay(today, -1));
	let best = current;
	for (const k of daily.keys()) if (met(k) && !met(shiftDay(k, 1))) best = Math.max(best, runEndingAt(k));
	const yesterday = shiftDay(today, -1);
	const lost = met(yesterday) ? 0 : runEndingAt(shiftDay(today, -2));
	return { current, best, today: daily.get(today) ?? 0, goal, lost };
}
