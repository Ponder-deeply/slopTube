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
npm run build   # type-check + production build + copy
```

`VAULT` defaults to `~/Documents/Brain`. Only `main.js`, `manifest.json` and
`styles.css` are copied; `bait.json` and `data.json` in the plugin folder are
never touched.

## Layout

| File | Role |
|---|---|
| `src/model.ts` | Notes → `NoteCard`s and channels, from `metadataCache` only |
| `src/feed.ts` | Chip filters, seeded weighted shuffle, shelf sorting |
| `src/thumb.ts` | Deterministic ASCII thumbnails (`composeThumb` is DOM-free) |
| `src/bait.ts` | Baked titles from `bait.json` (hand-editable from the watch page), template fallback |
| `src/related.ts` | Up-next ordering: outlinks → backlinks → same channel |
| `src/views/` | `FeedView`, `WatchView`, shared card component |

## Vault ↔ YouTube

Channel = subject, views = backlinks (inflated ×1000 for the genre), upload
date = `updated:`, duration = estimated reading time, ✔ = `derivation: source`.
