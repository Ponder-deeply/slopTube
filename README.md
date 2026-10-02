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

## Reflections

In the *Előadások* view each lecture shelf has a "Reflexió írása" button. It asks for a name
(prefilled "Reflexió — <topic>"), creates `Egyetem/<newest semester with the course>/<course>/<name>.md`
with a `reflection: "<lecture heading>"` property, a title and a Dataview query listing the wiki pages the hub links under that lecture (so the list follows the hub), and opens it in a new tab. An
existing note of that name is opened, never overwritten. A lecture's reflections (notes in the
course folder carrying that property) sit as numbered chips, oldest first, next to its title;
hovering a chip shows the note's name, clicking opens it in a new tab.

## Habit loop

Only notes marked `studied: true` in their front matter take part. Mark one with the
button on its watch page, the "Toggle studied on current note" command, or the "all notes of
this subject" command / "⋯" menu item (it asks first). A studied note is split into
**gates**, each hidden until you ask for it, then graded *Tudtam* / *Nem tudtam*:

- `base`: the text under the `# Title` heading;
- every `##` section except `## Kapocs`: one gate per `###` inside it, or the whole section
  as one gate when it has none. Ids are `tartalom` / `tartalom/<subheader>` for
  `## Tartalom` and `<heading>` / `<heading>/<subheader>` for any other section. Text
  between a `##` heading and its first `###` stays open, and so does `## Kapocs`.

Only due gates are blocked: one graded before and not yet below the due line opens, marked
"Még friss". A failed gate blocks again for another try; regrading a gate on the same day
replaces its earlier grade. Every gate has its own history in `recall.json`
(`notes[path][gate]`). Unstudied notes render open and are never graded. From the log:

- **Forgetting curve:** each note has a half-life `s` (days), R = 2^(−Δt/s).
  Per gate, the first grade sets s = 2 (known) or 1; later ones multiply it by
  1.8 + 2(1 − R) when known, by 0.4 when not. A gate is **due** below R = 0.7, and from the moment its note is marked studied until its first grade.
- **Golden cards:** a studied note with a due gate (never graded, or overdue). They rank higher in the feed
  (`overdueBoost`), carry a gold badge (*ÚJ* if never graded, else *ESEDÉKES*), at most 6 per page, and earn 3 credits
  on any grade of that gate, and a first grade always is (others earn 1). The *Esedékes* chip lists them, most overdue first.
- **Streak:** days whose credits reached the goal (`goalPerSubject` × active
  subjects). Credits are per note, not per gate: a note earns one on a day when
  every gate that was due got graded, the rest being fresh (3 if any of those grades was
  golden, else 1). Completions are recorded in `recall.json` (`done`) when they happen, so
  editing a note's headings later never changes the streak. The header
  shows the streak and today's progress.
- **Kept %:** per channel, over all its notes (hubs aside), as a bar of kept / studied but
  faded / not studied yet, with the kept and studied figures. A note's retention is the mean
  R across its gates (ungraded gates = 0), so every note weighs the same however many gates
  it has. Beside it, a 30-day sparkline of the studied notes' mean R alone, so a growing
  backlog of unstudied notes cannot hide a real decline; it turns red when the last week fell.
- **Owl:** one in-feed line, never a notification.
