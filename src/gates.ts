// Recall gates: the parts of a studied note that are hidden until recalled. Pure (no Obsidian
// imports), so it is unit-tested. Layout of a note (see the wiki's page template):
//
//   # Title
//   Summary text            → gate "base"
//   ## Tartalom             → every ## section but Kapocs is content; others (## Definíció, …) work alike
//   ### Subheader           → gate "tartalom/<Subheader>", one per ### (no ### → one gate "tartalom")
//   ## Kapocs               → never gated
//
// A section's id is "tartalom" for ## Tartalom and its heading text for any other; text between
// a ## heading and its first ### stays open.

export const BASE_GATE = "base";
export const CONTENT_GATE = "tartalom";

export interface Heading {
	level: number;
	title: string;
	/** 0-based line of the heading. */
	line: number;
}

/** A gate's span: lines [start, to) leave the open text; the body is lines [bodyFrom, to). */
interface GateRange {
	id: string;
	label: string;
	start: number;
	bodyFrom: number;
	to: number;
}

export type Segment = { kind: "open"; text: string } | { kind: "gate"; id: string; label: string; text: string };

/** Gate ids in note order. `hasContent(from, to)`: is there any non-heading content in lines [from, to)? */
function layout(headings: readonly Heading[], hasContent: (from: number, to: number) => boolean): GateRange[] {
	const h1 = headings.findIndex((h) => h.level === 1);
	if (h1 < 0) return [];
	const out: GateRange[] = [];
	const nextLine = (i: number, maxLevel = 6) => headings.slice(i + 1).find((h) => h.level <= maxLevel)?.line ?? Infinity;

	const baseEnd = headings[h1 + 1]?.line ?? Infinity;
	const baseFrom = headings[h1].line + 1;
	if (hasContent(baseFrom, baseEnd)) out.push({ id: BASE_GATE, label: "Összefoglaló", start: baseFrom, bodyFrom: baseFrom, to: baseEnd });

	const seen = new Map<string, number>();
	const unique = (id: string) => {
		const n = (seen.get(id) ?? 0) + 1;
		seen.set(id, n);
		return n > 1 ? `${id} (${n})` : id;
	};
	headings.forEach((section, i) => {
		const name = section.title.trim();
		if (i <= h1 || section.level !== 2 || name.toLowerCase() === "kapocs") return;
		const key = name.toLowerCase() === "tartalom" ? CONTENT_GATE : name;
		const end = nextLine(i, 2);
		const subs = headings.filter((h) => h.level === 3 && h.line > section.line && h.line < end);
		if (!subs.length) {
			if (hasContent(section.line + 1, end)) out.push({ id: unique(key), label: name, start: section.line, bodyFrom: section.line + 1, to: end });
			return;
		}
		for (const sub of subs) {
			const title = sub.title.trim();
			const to = Math.min(nextLine(headings.indexOf(sub), 3), end);
			if (hasContent(sub.line + 1, to)) {
				out.push({ id: unique(`${key}/${title}`), label: key === CONTENT_GATE ? title : `${name} › ${title}`, start: sub.line, bodyFrom: sub.line + 1, to });
			}
		}
	});
	return out;
}

/** Gate ids from Obsidian's cache: its headings and the start lines of its non-heading sections. */
export function gateIds(headings: readonly Heading[], contentLines: readonly number[]): string[] {
	return layout(headings, (from, to) => contentLines.some((l) => l >= from && l < to)).map((g) => g.id);
}

/** Splits a note's text (front matter already removed) into open text and gated parts, in order. */
export function parseGates(text: string): Segment[] {
	const lines = text.split("\n");
	const headings: Heading[] = [];
	let fence: string | null = null;
	lines.forEach((raw, line) => {
		const f = raw.match(/^\s*(```+|~~~+)/)?.[1];
		if (f) {
			if (!fence) fence = f[0];
			else if (f[0] === fence) fence = null;
			return;
		}
		const m = !fence && raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
		if (m) headings.push({ level: m[1].length, title: m[2], line });
	});
	const gates = layout(headings, (from, to) => lines.slice(from, Math.min(to, lines.length)).some((l) => l.trim() !== ""));

	const out: Segment[] = [];
	let cursor = 0;
	const open = (to: number) => {
		const chunk = lines.slice(cursor, to).join("\n");
		if (chunk.trim()) out.push({ kind: "open", text: chunk });
	};
	for (const g of gates) {
		open(g.start);
		const to = Math.min(g.to, lines.length);
		out.push({ kind: "gate", id: g.id, label: g.label, text: lines.slice(g.bodyFrom, to).join("\n").trim() });
		cursor = to;
	}
	open(lines.length);
	return out;
}
