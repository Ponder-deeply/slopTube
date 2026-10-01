# SlopTube

An Obsidian plugin that shows the Brain vault's wiki (`Wiki/concepts/**`,
`Wiki/subjects/*`) as a YouTube-style feed: ASCII-art thumbnails, clickbait
titles, a watch page that renders the note, and an "up next" rail of
connected notes that appears when the mouse reaches the bottom edge.

**Goal:** passive review for the active semester's exams. The random feed
favors subjects that have a course folder in the newest `Egyetem/` semester,
and every baked title hides a real fact from its note, so a card works as a
recall prompt.

## Develop

```sh
npm install
npm run dev     # watch, rebuild, copy into $VAULT/.obsidian/plugins/sloptube
npm run build   # type-check + tests + production build + copy
npm test        # unit tests (node:test) for the pure modules
```

`VAULT` defaults to `~/Documents/Brain`. Only `main.js`, `manifest.json` and
`styles.css` are copied; `bait.json`, `recall.json` and `data.json` in the
plugin folder are never touched.

## Layout

| File | Role |
|---|---|
| `src/model.ts` | Notes → `NoteCard`s and channels, from `metadataCache` only |
| `src/feed.ts` | Chip filters, seeded weighted shuffle, shelf sorting |
| `src/thumb.ts` | Deterministic ASCII thumbnails (`composeThumb` is DOM-free) |
| `src/bait.ts` | Baked titles from `bait.json` (hand-editable from the watch page), template fallback |
| `src/related.ts` | Up-next ordering: outlinks → backlinks → same channel |
| `src/memory.ts` | Forgetting curve: half-lives, overdue, kept %, credits, streak (pure) |
| `src/recall.ts` | The recall log, `recall.json` in the plugin folder |
| `src/owl.ts` | The owl's line under the chips |
| `src/views/` | `FeedView`, `WatchView`, shared card component |

## Vault ↔ YouTube

Channel = subject, views = backlinks (inflated ×1000 for the genre), upload
date = `updated:`, duration = estimated reading time, ✔ = `derivation: source`.

## Habit loop

The watch page shows the bait title as a question and hides the hook (its
answer) and the note until you ask for it; then you grade yourself *Tudtam* /
*Nem tudtam*. Only graded recalls count. From the log in `recall.json`:

- **Forgetting curve:** each note has a half-life `s` (days), R = 2^(−Δt/s).
  First grade sets s = 2 (known) or 1; later ones multiply it by
  1.8 + 2(1 − R) when known, by 0.4 when not. A note is **due** below R = 0.7.
- **Golden cards:** recalled before and now due. They rank higher in the feed
  (`overdueBoost`), carry a gold badge, at most 6 per page, and earn 3 credits
  on any grade (others earn 1). The *Esedékes* chip lists them, most overdue first.
- **Streak:** days whose credits reached the goal (`goalPerSubject` × active
  subjects). The header shows the streak and today's progress.
- **Kept %:** per channel, mean R over all its notes (unseen = 0), as a 30-day
  sparkline in the shelf header and on the watch page.
- **Owl:** one in-feed line, never a notification.
