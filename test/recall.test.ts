import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY } from "../src/memory.ts";
import { RecallStore } from "../src/recall.ts";

// recall.ts schedules saves on `window`, as Obsidian plugins do.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

const T0 = new Date(2026, 9, 1, 10).getTime();
const G: string[] = []; // gates not under test: no completion is recorded

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

test("a second grade of a gate on the same day replaces the first; gates are independent", async () => {
	const { s } = await store();
	s.grade("a.md", "base", 0, 6, G, T0);
	s.grade("a.md", "base", 1, 6, G, T0 + 1000);
	assert.deepEqual(s.events("a.md", "base"), [{ t: T0 + 1000, g: 1 }]);
	s.grade("a.md", "tartalom/X", 1, 6, G, T0);
	s.grade("a.md", "base", 1, 6, G, T0 + DAY);
	assert.equal(s.events("a.md", "base").length, 2);
	assert.equal(s.gradedToday("a.md", "base", T0 + DAY)?.g, 1);
	assert.equal(s.gradedToday("a.md", "tartalom/X", T0 + DAY), null);
	assert.equal(s.touchedToday("a.md", T0 + DAY), true);
	assert.equal(s.touchedToday("b.md", T0), false);
	await s.flush();
});

test("daily credits: a note earns only on a day all its gates were graded; golden if any grade was", async () => {
	const { s } = await store();
	const a = ["base", "tartalom/X"];
	s.grade("a.md", "base", 1, 6, a, T0);
	s.grade("b.md", "base", 1, 6, ["base"], T0);
	s.grade("c.md", "base", 1, 6, [], T0); // not studied: earns nothing
	assert.equal(s.daily().get("2026-10-01"), 3); // b.md only; a.md is half done
	s.grade("a.md", "tartalom/X", 1, 6, a, T0 + 3 * DAY);
	s.grade("a.md", "base", 1, 6, a, T0 + 3 * DAY); // base overdue by then
	assert.equal(s.daily().get("2026-10-04"), 3);
	assert.equal(s.daily().get("2026-10-01"), 3);
	assert.equal(s.goals["2026-10-04"], 6);
	await s.flush();
});

test("fresh gates do not stand in the way of completing a note", async () => {
	const { s } = await store();
	const a = ["base", "x"];
	s.grade("a.md", "base", 1, 6, a, T0);
	s.grade("a.md", "x", 1, 6, a, T0);
	s.grade("a.md", "base", 1, 6, a, T0 + 3 * DAY); // base due; x (s = 2 d) is due too, so not complete yet
	assert.equal(s.daily().get("2026-10-04"), undefined);
	s.grade("a.md", "x", 1, 6, a, T0 + 3 * DAY);
	assert.equal(s.daily().get("2026-10-04"), 3);
});

test("a gate that is still fresh does not block completion", async () => {
	const { s } = await store();
	const a = ["base", "x"];
	s.grade("a.md", "base", 1, 6, a, T0); // s = 2 d
	s.grade("a.md", "x", 1, 6, a, T0);
	s.grade("a.md", "x", 1, 6, a, T0 + 2 * DAY); // s grows to about 5.6 d; base is due, so not complete
	assert.equal(s.daily().get("2026-10-03"), undefined);
	s.grade("a.md", "base", 1, 6, a, T0 + 3 * DAY); // x is still fresh
	assert.equal(s.daily().get("2026-10-04"), 3);
});

test("a completed day survives later gate changes and is carried by a rename", async () => {
	const { s, adapter } = await store();
	s.grade("a.md", "base", 1, 6, ["base"], T0);
	assert.equal(s.daily().get("2026-10-01"), 3);
	s.grade("a.md", "extra", 1, 6, ["base", "extra"], T0 + DAY); // the note grew a gate; today is its own day
	s.rename("a.md", "z.md");
	assert.equal(s.daily().get("2026-10-01"), 3);
	await s.flush();
	assert.equal((await store(adapter.files)).s.daily().get("2026-10-01"), 3);
});

test("a recall.json without completions is migrated once from the current gates", async () => {
	const old = { version: 2, notes: { "a.md": { base: [{ t: T0, g: 1 }], x: [{ t: T0, g: 1 }] } }, goals: {} };
	const { s } = await store({ "plugin/recall.json": JSON.stringify(old) });
	s.backfill(() => ["base", "x"]);
	assert.equal(s.daily().get("2026-10-01"), 3);
	s.backfill(() => []); // already done
	assert.equal(s.daily().get("2026-10-01"), 3);
});

test("a studied note with an ungraded gate is fully overdue", async () => {
	const { s } = await store();
	const note = { path: "a.md", gates: ["base", "tartalom/X"] };
	assert.equal(s.overdue(note, T0), 1);
	s.grade("a.md", "base", 1, 6, G, T0);
	assert.equal(s.overdue(note, T0), 1); // tartalom/X still never graded
	s.grade("a.md", "tartalom/X", 1, 6, G, T0);
	assert.equal(s.overdue(note, T0), 0);
	assert.ok(s.overdue(note, T0 + 3 * DAY) > 0);
	assert.equal(s.overdue({ path: "a.md", gates: [] }, T0), 0); // not studied
});

test("a note is overdue as its most overdue gate; nextDue is the earliest", async () => {
	const { s } = await store();
	const note = { path: "a.md", gates: ["base", "tartalom/X"] };
	s.grade("a.md", "base", 1, 6, G, T0); // s = 2 days
	s.grade("a.md", "tartalom/X", 1, 6, G, T0 + 2 * DAY);
	assert.equal(s.overdue(note, T0 + DAY), 0);
	assert.ok(s.overdue(note, T0 + 3 * DAY) > 0);
	assert.equal(s.nextDue("b.md"), null);
	assert.ok(s.nextDue("a.md")! < T0 + 2 * DAY);
	await s.flush();
});

test("rename keeps history; flush writes recall.json; reload reads it back", async () => {
	const { s, adapter } = await store();
	s.grade("old.md", "base", 1, 6, G, T0);
	s.rename("old.md", "new.md");
	assert.equal(s.events("old.md", "base").length, 0);
	assert.equal(s.memory("new.md", "base")?.s, 2);
	await s.flush();
	const again = await store(adapter.files);
	assert.deepEqual(again.s.events("new.md", "base"), [{ t: T0, g: 1 }]);
});

test("a version 1 recall.json is dropped", async () => {
	const { s } = await store({ "plugin/recall.json": JSON.stringify({ version: 1, notes: { "a.md": [{ t: T0, g: 1 }] }, goals: {} }) });
	assert.equal(s.nextDue("a.md"), null);
	assert.equal(s.daily().size, 0);
});

test("a corrupt recall.json is never overwritten", async () => {
	const { s, adapter } = await store({ "plugin/recall.json": "{oops" });
	s.grade("a.md", "base", 1, 6, G, T0);
	await s.flush();
	assert.equal(adapter.files["plugin/recall.json"], "{oops");
});
