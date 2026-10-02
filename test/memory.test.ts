import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY, DUE_R, dayKey, keptSeries, credits, kept, nextHalfLife, overdue, recallProb, replay, shiftDay, streak } from "../src/memory.ts";

const T0 = new Date(2026, 9, 1, 10).getTime(); // 2026-10-01 10:00 local
const at = (days: number) => T0 + days * DAY;

test("R halves every half-life", () => {
	const m = { s: 2, last: T0 };
	assert.equal(recallProb(m, T0), 1);
	assert.ok(Math.abs(recallProb(m, at(2)) - 0.5) < 1e-12);
	assert.ok(Math.abs(recallProb(m, at(4)) - 0.25) < 1e-12);
});

test("half-life update: known on schedule ≈ ×2.4, unknown ×0.4 with a floor of 1", () => {
	assert.ok(Math.abs(nextHalfLife(10, DUE_R, 1) - 24) < 1e-9);
	assert.equal(nextHalfLife(10, 0.9, 0), 4);
	assert.equal(nextHalfLife(2, 0.9, 0), 1);
	assert.equal(nextHalfLife(150, 0.1, 1), 180);
});

test("first recall sets the half-life directly", () => {
	assert.deepEqual(replay([{ t: T0, g: 1 }]), { s: 2, last: T0 });
	assert.deepEqual(replay([{ t: T0, g: 0 }]), { s: 1, last: T0 });
	assert.equal(replay([]), null);
	assert.equal(replay([{ t: at(1), g: 1 }], T0), null);
});

test("a note known on day 0 turns due at about day 1, not before", () => {
	const m = replay([{ t: T0, g: 1 }]);
	assert.equal(overdue(m, at(0.9)), 0);
	assert.ok(overdue(m, at(1.1)) > 0);
	assert.equal(overdue(null, at(100)), 0);
});

test("kept % counts unrecalled notes as 0 and decays", () => {
	const histories = [[[{ t: T0, g: 1 as const }]], [[]]];
	assert.equal(kept(histories, T0), 50);
	assert.ok(kept(histories, at(2)) < 26);
	const series = keptSeries(histories, at(5), 7);
	assert.equal(series.length, 7);
	assert.equal(series[0], 0); // before the first recall
	assert.ok(series.at(-1)! < series[5]);
});

test("kept %: every note weighs the same, whatever its gate count", () => {
	const known = [{ t: T0, g: 1 as const }];
	const one = [[known]]; // 1 gate, graded
	const three = [[[], [], []]]; // 3 gates, none graded
	assert.equal(kept([...one, ...three], T0), 50); // gate-weighted would be 25
	assert.equal(kept([[known, []], ...three], T0), 25); // a half-graded note counts half
});

test("credits: 3 for a first grade or a recall of a gate that was overdue at the time", () => {
	const events = [
		{ t: T0, g: 1 as const },
		{ t: at(0.5), g: 1 as const },
		{ t: at(10), g: 0 as const },
	];
	assert.deepEqual(credits(events), [3, 1, 3]); // a first grade is always golden
});

test("day keys follow the local calendar", () => {
	assert.equal(dayKey(T0), "2026-10-01");
	assert.equal(shiftDay("2026-10-01", -1), "2026-09-30");
	assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
});

test("streak counts met days, tolerates an unfinished today, resets on a missed day", () => {
	const daily = new Map([
		["2026-09-27", 5],
		["2026-09-28", 5],
		["2026-09-29", 5],
		["2026-09-30", 5],
		["2026-10-01", 2],
	]);
	const s = streak(daily, {}, 5, "2026-10-01");
	assert.deepEqual(s, { current: 4, best: 4, today: 2, goal: 5, lost: 0 });

	const broken = streak(daily, {}, 5, "2026-10-02");
	assert.equal(broken.current, 0);
	assert.equal(broken.best, 4);
	assert.equal(broken.lost, 4);

	// A past day is judged by the goal it had then.
	const old = streak(new Map([["2026-09-30", 3]]), { "2026-09-30": 3 }, 9, "2026-10-01");
	assert.equal(old.current, 1);
});
