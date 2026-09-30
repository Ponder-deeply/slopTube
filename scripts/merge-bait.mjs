// Validates baked bait files and merges them into the vault's bait.json.
//
//   node scripts/merge-bait.mjs [--write] [--force] batch1.json batch2.json …
//
// Without --write it only reports. Existing bait.json entries are kept unless --force.
// Checks the mechanical rules of BAIT_STYLE.md; the Hungarian itself still needs a human.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const vault = process.env.VAULT ?? join(homedir(), "Documents/Brain");
const baitPath = join(vault, ".obsidian/plugins/sloptube/bait.json");
const args = process.argv.slice(2);
const write = args.includes("--write");
const force = args.includes("--force");
const inputs = args.filter((a) => !a.startsWith("--"));

// Mirrors the block font in src/thumb.ts (after accent folding).
const FONT_CHARS = /^[A-Z0-9!?.\-+=%' ]*$/;
const FORMATS = new Set(["story", "impossible", "everyday", "person", "challenge"]);
const EMOJI = /\p{Extended_Pictographic}/gu;
const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

/** Acronyms are names, not emphasis; they never count as a CAPS phrase. */
const ACRONYMS = new Set([
	"QR", "LU", "LDU", "LDL", "LER", "SVD", "RSA", "AES", "DES", "DFT", "FFT", "CRC", "IEEE", "LNKO", "LKKT",
	"ASCII", "ID", "OK", "PDF", "CPU", "GPU", "API", "UI", "GUI", "IDE", "WPF", "XAML", "MVVM", "MVC", "JSON", "XML",
	"HTML", "SQL", "HDFS", "YARN", "RDD", "CNN", "KNN", "PCA", "SVM", "TF", "IDF", "ISBN", "NP", "SAT", "DNF", "KNF",
]);

/** Runs of consecutive all-caps words (≥ 2 letters, not acronyms) count as one CAPS phrase. */
function capsPhrases(title) {
	let phrases = 0, inRun = false;
	for (const w of title.split(/\s+/)) {
		const letters = w.replace(/[^\p{L}]/gu, "");
		const caps = letters.length >= 2 && !ACRONYMS.has(letters) && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
		if (caps && !inRun) phrases++;
		inRun = caps;
	}
	return phrases;
}


function check(path, e) {
	const problems = [];
	if (!existsSync(join(vault, path))) return ["note does not exist"];
	for (const k of ["title", "thumbText", "hook"]) if (typeof e[k] !== "string" || !e[k]) problems.push(`missing ${k}`);
	if (problems.length) return problems;
	if (e.format && !FORMATS.has(e.format)) problems.push(`unknown format ${e.format}`);
	if (capsPhrases(e.title) > 1) problems.push("more than one CAPS phrase");
	if ((e.title.match(EMOJI) ?? []).length > 1) problems.push("more than one emoji");
	const words = e.thumbText.trim().split(/\s+/);
	if (words.length > 3) problems.push("thumbText over 3 words");
	if (words.some((w) => w.length > 12)) problems.push("thumbText word over 12 chars");
	if (!FONT_CHARS.test(fold(e.thumbText))) problems.push(`thumbText has undrawable chars: ${fold(e.thumbText).replace(/[A-Z0-9!?.\-+=%' ]/g, "")}`);
	if (e.hook.includes("$")) problems.push("hook contains LaTeX $");
	return problems;
}

const bait = existsSync(baitPath) ? JSON.parse(readFileSync(baitPath, "utf8")) : {};
let added = 0, skipped = 0, bad = 0;
const formats = {};
let emoji = 0;
for (const file of inputs) {
	const batch = JSON.parse(readFileSync(file, "utf8"));
	for (const [path, e] of Object.entries(batch)) {
		const problems = check(path, e);
		if (problems.length) {
			bad++;
			console.log(`✗ ${path}\n    ${e.title ?? ""}\n    ${problems.join("; ")}`);
			continue;
		}
		formats[e.format ?? "?"] = (formats[e.format ?? "?"] ?? 0) + 1;
		emoji += (e.title.match(EMOJI) ?? []).length;
		if (bait[path] && !force) {
			skipped++;
			continue;
		}
		const { updated: _stale, ...entry } = e; // bakes used to carry `updated`; titles no longer go stale
		bait[path] = entry;
		added++;
	}
}
console.log(`\n${added} to add, ${skipped} already baked (kept), ${bad} rejected`);
console.log(`formats: ${JSON.stringify(formats)} · emoji: ${emoji}`);
if (write && added) {
	writeFileSync(baitPath, JSON.stringify(bait, null, 1) + "\n");
	console.log(`wrote ${baitPath} (${Object.keys(bait).length} entries)`);
}
