import assert from "node:assert/strict";
import { test } from "node:test";
import { gateIds, parseGates } from "../src/gates.ts";

const NOTE = `# Title

Summary line.

## Tartalom

Intro.

### Első

Body one.

\`\`\`
### not a heading
\`\`\`

### Második

Body two.

## Kapocs

- [[x]] — y
`;

test("base, one gate per ### under Tartalom, Kapocs open", () => {
	const segs = parseGates(NOTE);
	const gates = segs.filter((s) => s.kind === "gate");
	assert.deepEqual(gates.map((g) => g.id), ["base", "tartalom/Első", "tartalom/Második"]);
	assert.equal(gates[0].text, "Summary line.");
	assert.match(gates[1].text, /not a heading/);
	assert.equal(gates[2].text, "Body two.");
	const open = segs.filter((s) => s.kind === "open").map((s) => s.text).join("\n");
	assert.match(open, /# Title/);
	assert.match(open, /Intro\./);
	assert.match(open, /Kapocs/);
	assert.doesNotMatch(open, /Body/);
});

test("no subheaders: Tartalom is a single gate", () => {
	const segs = parseGates("# T\n\nSum.\n\n## Tartalom\n\nAll of it.\n\n## Kapocs\n\n- a\n");
	assert.deepEqual(segs.filter((s) => s.kind === "gate").map((g) => g.id), ["base", "tartalom"]);
});

test("empty parts and notes without the template produce no gates", () => {
	assert.deepEqual(parseGates("just text"), [{ kind: "open", text: "just text" }]);
	assert.deepEqual(parseGates("# T\n\n## Tartalom\n\n### A\n\n## Kapocs\n").filter((s) => s.kind === "gate"), []);
});

test("duplicate subheaders get distinct ids", () => {
	const ids = parseGates("# T\n\n## Tartalom\n\n### A\n\nx\n\n### A\n\ny\n").filter((s) => s.kind === "gate").map((g) => g.id);
	assert.deepEqual(ids, ["tartalom/A", "tartalom/A (2)"]);
});

test("gateIds from cache-like data agree with the parser", () => {
	const headings = [
		{ level: 1, title: "T", line: 0 },
		{ level: 2, title: "Tartalom", line: 4 },
		{ level: 3, title: "Első", line: 8 },
		{ level: 2, title: "Kapocs", line: 12 },
	];
	assert.deepEqual(gateIds(headings, [2, 6, 10, 14]), ["base", "tartalom/Első"]);
	assert.deepEqual(gateIds(headings, [6, 14]), []);
});

test("every ## section but Kapocs is gated; ids use the heading, Tartalom keeps its short id", () => {
	const note = "# T\n\nSum.\n\n## Definíció\n\nDef.\n\n## Bizonyítás\n\n### Lépés\n\nP.\n\n## Kapocs\n\n- [[a]]\n";
	const gates = parseGates(note).filter((s) => s.kind === "gate");
	assert.deepEqual(gates.map((g) => g.id), ["base", "Definíció", "Bizonyítás/Lépés"]);
	assert.equal(gates[2].label, "Bizonyítás › Lépés");
	const open = parseGates(note).filter((s) => s.kind === "open").map((s) => s.text).join("\n");
	assert.match(open, /## Kapocs/);
	assert.match(open, /## Bizonyítás/); // the section heading stays open when it has subheaders
});
