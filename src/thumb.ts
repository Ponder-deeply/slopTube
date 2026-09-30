// Deterministic ASCII-art thumbnails. Per note (seeded by path): a background field,
// a character ramp and a color scheme built on the channel's hue; a caption strip naming
// the channel and the note's section; block-letter thumbText on a cleared label; and the
// genre's red circle / arrow.

import { foldUpper, hash, pick, rng } from "./util";

export const COLS = 48;
export const ROWS = 18;

export interface ThumbSpec {
	/** Seeds everything; the note path, so a note's thumbnail never changes. */
	seed: string;
	/** Channel base hue (OKLCH degrees); keeps a channel's thumbnails recognisably related. */
	hue: number;
	/** Caption strip: channel id and the hub section the note belongs to. */
	channel: string;
	section: string | null;
	hasMath: boolean;
	hasCode: boolean;
	text: string;
}

export interface Cell {
	ch: string;
	fg: string;
	bg?: string;
}
export type Grid = Cell[][];

type Rand = () => number;
/** A background field: cell → intensity in [0, 1]. */
type Field = (x: number, y: number) => number;

const RAMPS = [" .:-=+*#%@", " ░▒▓█", " .oO@", " ·•●", " .01", " -~≈"].map((r) => [...r]);
const MATH_GLYPHS = [..."∑∫∂∇πλ∞≈≤≥⊂∀∃√±×∈⇒φψΩ"];
const CODE_TOKENS = ["fn", "let", "=>", "{", "}", "λ", "::", "->", "if", "map", "0x1F", "return", "==", "&&", "[]", "()", ";", "x", "i++"];
/** Second-hue offsets: mono, analogous, split-complementary, complementary, triadic. */
const SCHEMES = [0, 35, 150, 180, 210, -120];
const TEXT_COLORS = ["#ffe14d", "#ffffff", "#5ff6ff", "#ff5fd2", "#b6ff4f"];
const RED = "#ff3b3b";

// 3×5 block font, rows concatenated. Accents are folded before lookup (Á → A).
const FONT: Record<string, string> = {
	A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
	E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
	I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
	M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
	Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
	U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
	Y: "101101010010010", Z: "111001010100111",
	"0": "111101101101111", "1": "010110010010111", "2": "110001010100111", "3": "110001010001110",
	"4": "101101111001001", "5": "111100110001110", "6": "011100111101111", "7": "111001010010010",
	"8": "111101111101111", "9": "111101111001110",
	"!": "010010010000010", "?": "110001010000010", ".": "000000000000010", "-": "000000111000000",
	"+": "000010111010000", "=": "000111000111000", "%": "101001010100101", "'": "010010000000000",
};

/** Characters of `text` the block font cannot draw (spaces are fine); empty when all drawable. */
export function undrawable(text: string): string {
	return [...new Set([...foldUpper(text)].filter((ch) => ch !== " " && !FONT[ch]))].join("");
}

interface Palette {
	bg: string;
	ramp: string[];
	text: string;
	/** Caption strip: channel color block with dark lettering. */
	tag: string;
}

function palette(hue: number, r: Rand): Palette {
	const h2 = (hue + pick(SCHEMES, r) + 360) % 360;
	return {
		bg: `oklch(0.17 0.04 ${hue})`,
		ramp: [`oklch(0.34 0.09 ${hue})`, `oklch(0.52 0.15 ${hue})`, `oklch(0.7 0.17 ${h2})`, `oklch(0.87 0.14 ${h2})`],
		text: pick(TEXT_COLORS, r),
		tag: `oklch(0.8 0.15 ${hue})`,
	};
}

// ---------- Background fields ----------

const FIELDS: ((r: Rand) => Field)[] = [
	function plasma(r) {
		const [a, b, c, d] = [0.1 + r() * 0.25, 0.15 + r() * 0.4, 0.05 + r() * 0.2, 0.2 + r() * 0.5];
		const [p1, p2, p3] = [r() * 6.3, r() * 6.3, r() * 6.3];
		const [cx, cy] = [r() * COLS * 0.5, r() * ROWS];
		return (x, y) => {
			const xs = x * 0.5; // cells are about twice as tall as wide
			const v = Math.sin(xs * a * 4 + p1) + Math.sin(y * b + p2) + Math.sin((xs + y) * c * 3 + p3) + Math.sin(Math.hypot(xs - cx, y - cy) * d);
			return (v + 4) / 8;
		};
	},
	function rings(r) {
		const [cx, cy, f, p] = [r() * COLS * 0.5, r() * ROWS, 0.6 + r() * 0.8, r() * 6.3];
		return (x, y) => 0.5 + 0.5 * Math.sin(Math.hypot(x * 0.5 - cx, y - cy) * f + p);
	},
	function stripes(r) {
		const [a, b, f, p] = [r() * 2 - 1, r() * 2 - 1, 0.4 + r() * 0.6, r() * 6.3];
		return (x, y) => 0.5 + 0.5 * Math.sin((x * 0.5 * a + y * b) * f * 2 + p);
	},
	function spiral(r) {
		const [cx, cy, k, f] = [COLS * 0.25 + r() * 4, ROWS * 0.5, 2 + Math.floor(r() * 4), 0.5 + r() * 0.5];
		return (x, y) => {
			const dx = x * 0.5 - cx, dy = y - cy;
			return 0.5 + 0.5 * Math.sin(Math.atan2(dy, dx) * k + Math.hypot(dx, dy) * f);
		};
	},
	function blocks(r) {
		const [w, h] = [2 + Math.floor(r() * 5), 1 + Math.floor(r() * 3)];
		const seed = Math.floor(r() * 1e9);
		return (x, y) => rng(seed ^ hash(`${Math.floor(x / w)},${Math.floor(y / h)}`))();
	},
	function sunset(r) {
		const [f, p, amp] = [0.15 + r() * 0.3, r() * 6.3, 0.1 + r() * 0.15];
		return (x, y) => Math.min(1, Math.max(0, y / ROWS + amp * Math.sin(x * f + p)));
	},
];

function background(spec: ThumbSpec, pal: Palette, r: Rand): Grid {
	const field = pick(FIELDS, r)(r);
	const ramp = spec.hasMath ? null : pick(RAMPS, r);
	const grid: Grid = [];
	for (let y = 0; y < ROWS; y++) {
		const row: Cell[] = [];
		for (let x = 0; x < COLS; x++) {
			const v = field(x, y);
			const ch = ramp ? ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))] : v < 0.4 ? (r() < 0.3 ? "." : " ") : pick(MATH_GLYPHS, r);
			row.push({ ch, fg: pal.ramp[Math.min(3, Math.floor(v * 4))] });
		}
		grid.push(row);
	}
	if (spec.hasCode && !spec.hasMath) overlayCode(grid, pal, r);
	return grid;
}

/** Terminal motif: a few rows of pseudo-code over the field. */
function overlayCode(grid: Grid, pal: Palette, r: Rand): void {
	for (let y = 0; y < ROWS; y++) {
		if (r() < 0.35) continue;
		const prompt = y % 3 === 0;
		const tokens = Array.from({ length: 2 + Math.floor(r() * 5) }, () => pick(CODE_TOKENS, r)).join(" ");
		const line = prompt ? `$ ${tokens}` : " ".repeat(2 + Math.floor(r() * 3) * 2) + tokens;
		[...line].slice(0, COLS).forEach((ch, x) => {
			grid[y][x] = { ch, fg: prompt && x < 2 ? pal.ramp[3] : pick(pal.ramp.slice(1), r) };
		});
	}
}

// ---------- Overlays ----------

/** Top strip: "analiii › Metrikus és normált terek". Returns the rows it occupies. */
function drawCaption(grid: Grid, spec: ThumbSpec, pal: Palette): number {
	let label = ` ${spec.channel}${spec.section ? ` › ${spec.section}` : ""} `;
	if (label.length > COLS) label = `${label.slice(0, COLS - 2)}… `;
	[...label].forEach((ch, x) => (grid[0][x] = { ch, fg: pal.bg, bg: pal.tag }));
	return 1;
}

/** Greedy word wrap at the largest horizontal scale that fits in `maxLines`. */
function layoutText(text: string, maxLines: number): { lines: string[]; scale: number } {
	const words = foldUpper(text)
		.split(/\s+/)
		.map((w) => [...w].filter((ch) => FONT[ch]).join(""))
		.filter(Boolean);
	for (const scale of [2, 1]) {
		const maxChars = Math.floor((COLS + 1) / (3 * scale + 1));
		const lines: string[] = [];
		for (const word of words) {
			for (let i = 0; i < word.length; i += maxChars) {
				const part = word.slice(i, i + maxChars);
				const last = lines[lines.length - 1];
				if (last !== undefined && i === 0 && last.length + 1 + part.length <= maxChars) lines[lines.length - 1] = `${last} ${part}`;
				else lines.push(part);
			}
		}
		if (lines.length <= maxLines || scale === 1) return { lines: lines.slice(0, maxLines), scale };
	}
	return { lines: [], scale: 1 };
}

/**
 * Block letters on a cleared label box per line (background noise never leaks between
 * strokes), placed in rows [top, ROWS). Returns the reserved area for decorations to avoid.
 */
function drawText(grid: Grid, text: string, pal: Palette, top: number, r: Rand): boolean[][] {
	const reserved = grid.map((row) => row.map(() => false));
	const room = ROWS - top;
	// Each line is 5 rows + 1 gap; the label box adds a row of margin above and below.
	const { lines, scale } = layoutText(text, Math.floor((room - 1) / 6));
	const advance = 3 * scale + 1;
	const height = lines.length * 6 - 1;
	// Vertical slot: centered, or hugging the top / bottom of the free area (label box needs a row of margin).
	const slack = room - height - 2;
	const y0 = top + 1 + (slack <= 0 ? 0 : pick([Math.floor(slack / 2), 0, slack], r));
	const leftAligned = r() < 0.35;
	const set = (x: number, y: number, cell: Cell) => {
		if (x < 0 || x >= COLS || y < top || y >= ROWS) return;
		grid[y][x] = cell;
		reserved[y][x] = true;
	};
	lines.forEach((line, li) => {
		const width = line.length * advance - 1;
		const left = leftAligned ? 2 : Math.floor((COLS - width) / 2);
		const ly = y0 + li * 6;
		for (let y = ly - 1; y <= ly + 5; y++) for (let x = left - 1; x <= left + width; x++) set(x, y, { ch: " ", fg: pal.bg });
		[...line].forEach((ch, ci) => {
			const bits = FONT[ch];
			if (!bits) return; // space
			for (let py = 0; py < 5; py++)
				for (let px = 0; px < 3; px++)
					if (bits[py * 3 + px] === "1")
						for (let s = 0; s < scale; s++) set(left + ci * advance + px * scale + s, ly + py, { ch: "█", fg: pal.text });
		});
	});
	return reserved;
}

/** The genre's red circle and arrow, kept off the text and caption. */
function decorate(grid: Grid, reserved: boolean[][], top: number, r: Rand): void {
	const put = (x: number, y: number, ch: string) => {
		if (x >= 0 && x < COLS && y >= top && y < ROWS && !reserved[y][x]) grid[y][x] = { ch, fg: RED };
	};
	if (r() < 0.35) {
		const [rx, ry] = [5 + r() * 4, 2.5 + r() * 1.5];
		const cx = r() < 0.5 ? rx + 1 : COLS - rx - 2;
		const cy = r() < 0.5 ? top + ry + 1 : ROWS - ry - 2;
		for (let t = 0; t < Math.PI * 2; t += 0.12) put(Math.round(cx + rx * Math.cos(t)), Math.round(cy + ry * Math.sin(t)), "O");
	}
	if (r() < 0.3) {
		const y = ROWS - 2 - Math.floor(r() * 3);
		[..."=====>"].forEach((ch, i) => put(1 + i, y, ch));
	}
}

// ---------- Entry points ----------

/** Pure composition, DOM-free: the grid plus its background color. */
export function composeThumb(spec: ThumbSpec): { grid: Grid; bg: string } {
	const r = rng(hash(spec.seed));
	const pal = palette(spec.hue, r);
	const grid = background(spec, pal, r);
	const top = drawCaption(grid, spec, pal);
	decorate(grid, drawText(grid, spec.text, pal, top, r), top, r);
	return { grid, bg: pal.bg };
}

export function renderThumb(el: HTMLElement, spec: ThumbSpec): void {
	const { grid, bg } = composeThumb(spec);
	el.empty();
	const pre = el.createEl("pre", { cls: "st-thumb-art" });
	pre.style.backgroundColor = bg;
	grid.forEach((row, y) => {
		let run = "", fg = row[0].fg, cellBg = row[0].bg;
		const flush = () => {
			if (!run) return;
			const span = pre.createSpan({ text: run });
			span.style.color = fg;
			if (cellBg) span.style.backgroundColor = cellBg;
		};
		for (const cell of row) {
			if (cell.fg !== fg || cell.bg !== cellBg) {
				flush();
				run = "";
				fg = cell.fg;
				cellBg = cell.bg;
			}
			run += cell.ch;
		}
		flush();
		if (y < ROWS - 1) pre.appendText("\n");
	});
}
