// The recall log: graded recalls per gate of each studied note (see gates.ts), persisted as
// recall.json next to bait.json. Everything else in the habit loop (gold, streak, kept %) is
// derived from it via memory.ts; every gate has its own forgetting curve.

import type { DataAdapter } from "obsidian";
import { DUE_R, type Memory, type RecallEvent, credits, dayKey, dueAt, overdue, recallProb, replay } from "./memory";

interface RecallFile {
	version: 2;
	/** Note path → gate id → graded recalls, oldest first. */
	notes: Record<string, Record<string, RecallEvent[]>>;
	/** Day key → the daily goal that day had, so a later settings change does not rewrite history. */
	goals: Record<string, number>;
	/**
	 * Day key → note path → credits the note earned by being completed that day (every gate graded).
	 * Recorded when it happens, so later edits to a note's gates cannot rewrite the streak.
	 */
	done: Record<string, Record<string, number>>;
}

/** Older events stop mattering to the model; the cap bounds the file. */
const MAX_EVENTS = 50;
const SAVE_DELAY = 2000;

export class RecallStore {
	private data: RecallFile = { version: 2, notes: {}, goals: {}, done: {} };
	/** A recall.json from before `done` existed: derive it once the notes' gates are known. */
	private needsBackfill = false;
	private adapter: DataAdapter | null = null;
	private path = "";
	private saveTimer: number | null = null;
	private memo = new Map<string, Memory | null>();
	private dailyMemo: Map<string, number> | null = null;

	async load(adapter: DataAdapter, pluginDir: string): Promise<void> {
		this.adapter = adapter;
		this.path = `${pluginDir}/recall.json`;
		if (!(await adapter.exists(this.path))) return;
		try {
			const raw = JSON.parse(await adapter.read(this.path)) as { version?: number } & Partial<RecallFile>;
			// Version 1 logged one grade list per note, with no gates; that history is dropped.
			if (raw.version === 2) {
				this.data = { version: 2, notes: raw.notes ?? {}, goals: raw.goals ?? {}, done: raw.done ?? {} };
				this.needsBackfill = !raw.done && Object.keys(this.data.notes).length > 0;
			}
		} catch (e) {
			console.error("[sloptube] recall.json is not valid JSON; starting empty and not overwriting it", e);
			this.adapter = null;
		}
	}

	events(path: string, gate: string): readonly RecallEvent[] {
		return this.data.notes[path]?.[gate] ?? [];
	}

	get goals(): Readonly<Record<string, number>> {
		return this.data.goals;
	}

	memory(path: string, gate: string): Memory | null {
		const key = `${path}\0${gate}`;
		if (!this.memo.has(key)) this.memo.set(key, replay(this.events(path, gate)));
		return this.memo.get(key)!;
	}

	/** Memories of every gate of a note that has been graded. */
	private memories(path: string): Memory[] {
		return Object.keys(this.data.notes[path] ?? {})
			.map((gate) => this.memory(path, gate))
			.filter((m): m is Memory => m !== null);
	}

	/** Whether any gate of the note was ever graded. */
	hasHistory(path: string): boolean {
		return Object.keys(this.data.notes[path] ?? {}).length > 0;
	}

	/** Fully overdue (1) while a gate was never graded; otherwise as overdue as its most overdue gate. */
	overdue(note: { path: string; gates: readonly string[] }, now = Date.now()): number {
		let worst = 0;
		for (const gate of note.gates) {
			const m = this.memory(note.path, gate);
			if (!m) return 1;
			worst = Math.max(worst, overdue(m, now));
		}
		return worst;
	}

	/** When the first of a note's gates falls due; null when none was graded. */
	nextDue(path: string): number | null {
		const due = this.memories(path).map(dueAt);
		return due.length ? Math.min(...due) : null;
	}

	/** Today's grade of a gate, if it has one. */
	gradedToday(path: string, gate: string, now = Date.now()): RecallEvent | null {
		const events = this.events(path, gate);
		const last = events[events.length - 1];
		return last && dayKey(last.t) === dayKey(now) ? last : null;
	}

	/** Whether any gate of the note was graded today. */
	touchedToday(path: string, now = Date.now()): boolean {
		return Object.keys(this.data.notes[path] ?? {}).some((gate) => this.gradedToday(path, gate, now));
	}

	/** Logs a graded recall. A second grade of the same gate on the same day replaces the first. */
	grade(path: string, gate: string, g: 0 | 1, goal: number, gates: readonly string[], now = Date.now()): void {
		this.needsBackfill = false;
		if (this.gradedToday(path, gate, now)) this.data.notes[path][gate].pop();
		const events = ((this.data.notes[path] ??= {})[gate] ??= []);
		events.push({ t: now, g });
		if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
		this.data.goals[dayKey(now)] = goal;
		this.recordCompletion(path, gates, now);
		this.invalidate();
		this.scheduleSave();
	}

	/** Credits per local day, from the notes completed each day. */
	daily(): ReadonlyMap<string, number> {
		if (!this.dailyMemo) {
			const out = new Map<string, number>();
			for (const [day, notes] of Object.entries(this.data.done)) {
				out.set(day, Object.values(notes).reduce((a, b) => a + b, 0));
			}
			this.dailyMemo = out;
		}
		return this.dailyMemo;
	}

	/**
	 * A note earns credits on a day when at least one gate was graded and nothing else is left to
	 * do: every other gate is still fresh (not due). GOLD_CREDIT if any of the grades was golden,
	 * else CREDIT. Recorded once; a note's gates changing later does not undo it, and regrading
	 * only refreshes the amount.
	 */
	private recordCompletion(path: string, gates: readonly string[], now: number): void {
		const day = dayKey(now);
		const earned: number[] = [];
		for (const gate of gates) {
			const events = this.events(path, gate);
			const last = events[events.length - 1];
			if (last && dayKey(last.t) === day) {
				earned.push(credits(events)[events.length - 1]);
				continue;
			}
			const m = this.memory(path, gate);
			if (!m || recallProb(m, now) < DUE_R) return;
		}
		if (!earned.length) return;
		((this.data.done[day] ??= {})[path] = Math.max(...earned));
	}

	/** One-time migration of a recall.json without `done`: replays it against the current gates. */
	backfill(gatesOf: (path: string) => readonly string[]): void {
		if (!this.needsBackfill) return;
		this.needsBackfill = false;
		for (const [path, logged] of Object.entries(this.data.notes)) {
			const gates = gatesOf(path);
			if (!gates.length) continue;
			const perGate = gates.map((gate) => {
				const events = logged[gate] ?? [];
				const earned = credits(events);
				return new Map(events.map((e, i) => [dayKey(e.t), earned[i]] as const));
			});
			for (const day of perGate[0].keys()) {
				if (perGate.every((days) => days.has(day))) ((this.data.done[day] ??= {})[path] = Math.max(...perGate.map((days) => days.get(day)!)));
			}
		}
		this.invalidate();
		this.scheduleSave();
	}

	/** Keeps a renamed note's history. */
	rename(oldPath: string, newPath: string): void {
		const gates = this.data.notes[oldPath];
		if (!gates) return;
		delete this.data.notes[oldPath];
		this.data.notes[newPath] = gates;
		for (const notes of Object.values(this.data.done)) {
			if (oldPath in notes) {
				notes[newPath] = notes[oldPath];
				delete notes[oldPath];
			}
		}
		this.invalidate();
		this.scheduleSave();
	}

	/** Writes now if a save is pending (on unload). */
	async flush(): Promise<void> {
		if (this.saveTimer === null) return;
		window.clearTimeout(this.saveTimer);
		this.saveTimer = null;
		await this.write();
	}

	/** Same layout as bait.json, so vault commits diff line by line. */
	private async write(): Promise<void> {
		await this.adapter?.write(this.path, JSON.stringify(this.data, null, 1) + "\n");
	}

	/** Drops derived caches; call when the notes' gates change. */
	invalidate(): void {
		this.memo.clear();
		this.dailyMemo = null;
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.write();
		}, SAVE_DELAY);
	}
}
