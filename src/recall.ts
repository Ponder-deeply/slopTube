// The recall log: graded recalls per note, persisted as recall.json next to bait.json.
// Everything else in the habit loop (gold, streak, kept %) is derived from it via memory.ts.

import type { DataAdapter } from "obsidian";
import { type Memory, type RecallEvent, credits, dayKey, replay } from "./memory";

interface RecallFile {
	version: 1;
	/** Note path → graded recalls, oldest first. */
	notes: Record<string, RecallEvent[]>;
	/** Day key → the daily goal that day had, so a later settings change does not rewrite history. */
	goals: Record<string, number>;
}

/** Older events stop mattering to the model; the cap bounds the file. */
const MAX_EVENTS = 50;
const SAVE_DELAY = 2000;

export class RecallStore {
	private data: RecallFile = { version: 1, notes: {}, goals: {} };
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
			const raw = JSON.parse(await adapter.read(this.path)) as Partial<RecallFile>;
			this.data = { version: 1, notes: raw.notes ?? {}, goals: raw.goals ?? {} };
		} catch (e) {
			console.error("[sloptube] recall.json is not valid JSON; starting empty and not overwriting it", e);
			this.adapter = null;
		}
	}

	events(path: string): readonly RecallEvent[] {
		return this.data.notes[path] ?? [];
	}

	get goals(): Readonly<Record<string, number>> {
		return this.data.goals;
	}

	memory(path: string): Memory | null {
		if (!this.memo.has(path)) this.memo.set(path, replay(this.events(path)));
		return this.memo.get(path)!;
	}

	/** Today's grade of a note, if it has one. */
	gradedToday(path: string, now = Date.now()): RecallEvent | null {
		const events = this.events(path);
		const last = events[events.length - 1];
		return last && dayKey(last.t) === dayKey(now) ? last : null;
	}

	/** Logs a graded recall. A second grade of the same note on the same day replaces the first. */
	grade(path: string, g: 0 | 1, goal: number, now = Date.now()): void {
		const events = (this.data.notes[path] ??= []);
		if (this.gradedToday(path, now)) events.pop();
		events.push({ t: now, g });
		if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
		this.data.goals[dayKey(now)] = goal;
		this.invalidate(path);
		this.scheduleSave();
	}

	/** Credits per local day, over every note. */
	daily(): ReadonlyMap<string, number> {
		if (!this.dailyMemo) {
			const out = new Map<string, number>();
			for (const events of Object.values(this.data.notes)) {
				const earned = credits(events);
				events.forEach((e, i) => out.set(dayKey(e.t), (out.get(dayKey(e.t)) ?? 0) + earned[i]));
			}
			this.dailyMemo = out;
		}
		return this.dailyMemo;
	}

	/** Keeps a renamed note's history. */
	rename(oldPath: string, newPath: string): void {
		const events = this.data.notes[oldPath];
		if (!events) return;
		delete this.data.notes[oldPath];
		this.data.notes[newPath] = events;
		this.invalidate(oldPath);
		this.invalidate(newPath);
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

	private invalidate(path: string): void {
		this.memo.delete(path);
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
