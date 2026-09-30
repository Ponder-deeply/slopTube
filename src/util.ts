// Small pure helpers shared across modules: hashing, seeded randomness, formatting.

/** FNV-1a 32-bit hash; stable across sessions, so thumbnails never change. */
export function hash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** Mulberry32 PRNG: returns a function yielding floats in [0, 1). */
export function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function pick<T>(items: readonly T[], r: () => number): T {
	return items[Math.floor(r() * items.length)];
}

/** Hungarian YouTube-style view count. Real backlinks, inflated for the genre. */
export function formatViews(backlinks: number, seed: number): string {
	const n = backlinks * 1000 + (seed % 997);
	const hu = (x: number) => x.toFixed(1).replace(".", ",").replace(",0", "");
	if (n < 1000) return `${n} megtekintés`;
	if (n < 10_000) return `${hu(n / 1000)} E megtekintés`;
	if (n < 1_000_000) return `${Math.floor(n / 1000)} E megtekintés`;
	return `${hu(n / 1_000_000)} M megtekintés`;
}

/** "3 napja", "2 hete", … from an ISO date; empty when the date is missing. */
export function formatAge(iso: string | null, now = Date.now()): string {
	if (!iso) return "";
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return "";
	const days = Math.floor((now - t) / 86_400_000);
	if (days <= 0) return "ma";
	if (days === 1) return "tegnap";
	if (days < 7) return `${days} napja`;
	if (days < 30) return `${Math.floor(days / 7)} hete`;
	if (days < 365) return `${Math.floor(days / 30)} hónapja`;
	return `${Math.floor(days / 365)} éve`;
}

/** Video duration from an estimated word count at 200 wpm, as m:ss. */
export function formatDuration(words: number): string {
	const secs = Math.max(30, Math.round((words / 200) * 60));
	return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/** Folds Hungarian accents to ASCII and uppercases; used by the block font. */
export function foldUpper(s: string): string {
	return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}
