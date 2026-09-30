// "Up next": notes connected to the one being watched.

import type { NoteCard, VaultModel } from "./model";
import { hash, rng } from "./util";

/** Outlinks first, then backlinks, then same-channel notes (seeded by path) to fill the rail. */
export function relatedCards(card: NoteCard, model: VaultModel, limit: number): NoteCard[] {
	const out: NoteCard[] = [];
	const seen = new Set([card.path]);
	const add = (path: string) => {
		const c = model.byPath.get(path);
		if (c && !seen.has(path) && out.length < limit) {
			seen.add(path);
			out.push(c);
		}
	};
	card.outlinks.forEach(add);
	card.backlinks.forEach(add);

	const siblings = model.channel(card.subject)?.cards ?? [];
	const r = rng(hash(card.path));
	const shuffled = siblings.map((c) => ({ c, k: r() })).sort((a, b) => a.k - b.k);
	shuffled.forEach(({ c }) => add(c.path));
	return out;
}
