import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY } from "../src/memory.ts";
import { RecallStore } from "../src/recall.ts";

// recall.ts schedules saves on `window`, as Obsidian plugins do.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

const T0 = new Date(2026, 9, 1, 10).getTime();

function fakeAdapter(files: Record<string, string> = {}) {
	return {
		files,
		exists: async (p: string) => p in files,
		read: async (p: string) => files[p],
		write: async (p: string, data: string) => void (files[p] = data),
	};
}

async function store(files?: Record<string, string>) {
	const adapter = fakeAdapter(files);
	const s = new RecallStore();
	await s.load(adapter as never, "plugin");
	return { s, adapter };
}

test("a second grade on the same day replaces the first", async () => {
	const { s } = await store();
	s.grade("a.md", 1, 6, T0);
	s.grade("a.md", 0, 6, T0 + 1000);
	assert.deepEqual(s.events("a.md"), [{ t: T0 + 1000, g: 0 }]);
	s.grade("a.md", 1, 6, T0 + DAY);
	assert.equal(s.events("a.md").length, 2);
	assert.equal(s.gradedToday("a.md", T0 + DAY)?.g, 1);
	assert.equal(s.gradedToday("b.md", T0), null);
	await s.flush();
});

test("daily credits: overdue recalls earn 3", async () => {
	const { s } = await store();
	s.grade("a.md", 1, 6, T0);
	s.grade("b.md", 1, 6, T0);
	s.grade("a.md", 1, 6, T0 + 3 * DAY); // overdue by then
	assert.equal(s.daily().get("2026-10-01"), 2);
	assert.equal(s.daily().get("2026-10-04"), 3);
	assert.equal(s.goals["2026-10-04"], 6);
	await s.flush();
});

test("rename keeps history; flush writes recall.json; reload reads it back", async () => {
	const { s, adapter } = await store();
	s.grade("old.md", 1, 6, T0);
	s.rename("old.md", "new.md");
	assert.equal(s.events("old.md").length, 0);
	assert.equal(s.memory("new.md")?.s, 2);
	await s.flush();
	const again = await store(adapter.files);
	assert.deepEqual(again.s.events("new.md"), [{ t: T0, g: 1 }]);
});

test("a corrupt recall.json is never overwritten", async () => {
	const { s, adapter } = await store({ "plugin/recall.json": "{oops" });
	s.grade("a.md", 1, 6, T0);
	await s.flush();
	assert.equal(adapter.files["plugin/recall.json"], "{oops");
});
