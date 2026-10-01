# Bait style guide

The authority for every baked title in `bait.json`. A bake reads this first;
feedback from the user updates this file, never a copy of it.

## The brief

The best YouTube packaging team, working for good: every card is a curiosity
gap that a **real fact from the note** closes. The title asks, the hook
answers, so each card is a recall prompt. Never promise what the note does not
contain.

## Language (Hungarian)

- **Natural Hungarian first.** Read the title aloud; if a native speaker would
  not say it, rewrite it. Word order, suffixes and verb choice matter more than
  punch (*kavard meg*, not *keverd meg*, for coffee).
- **Fragments are fine, often better.** Titles and hooks need not be full
  sentences; forcing full sentences is what produces clumsy grammar.
- **CAPS** on the one word that carries the twist, and only where the stress
  is natural when spoken. At most one caps phrase per title.
- **Emoji:** optional, at most one, **only ironic** (🙃 📞 🙂), never hype
  (🤯 🔥 😱). Most titles have none.
- Technical terms as the note writes them.

## Formats

Kept (rotate them; no two neighbours in a subject share a format):

- **Mini story:** "I did X, and Y" (*Felcseréltem a deriválás sorrendjét. MÁS jött ki.*)
- **Impossible, yet:** (*NINCS primitív függvénye. Mégis kiszámoltam.*)
- **Everyday image:** the theorem as coffee, a fence, a ruler (*Kavard meg a kávét…*)
- **Gossip / a person:** a quote or a mathematician as a character (*Erdős szerint…*)
- **Challenge the viewer:** a question they can answer after watching (*Hányszor kerülted meg?*)

Dropped:

- **Shocking fact with a number** (*p = 0,99-nél minden összeomlik*). A number
  may appear inside another format, but it is never the hook itself.

## Lessons from review

- **Concrete over clever** (dimatii rebake, 2026-09-30). The title names the
  concept first, then gives a concrete question or claim about it, using the
  note's own example: *Euler–Fermat: a 3¹¹¹ utolsó jegye fejben*, not
  *Mi a 3¹¹¹ utolsó számjegye?*. Keep it snappy, informational and short. CAPS
  and ironic emoji are rarely needed. This shape wins over strict format
  rotation.

- **No ambiguous words.** *Megfordítva: egy sor* reads as "a series"; pick words
  with one reading in a math context.
- **Cryptic is not curious.** The viewer must understand the question without
  the note (*Belülről sosem lett TÖBB* → *…TÖBB, mint kívülről*).
- **thumbText never gives the answer away** (`E-1 PER 2` spoiled the hook).
- **Don't overclaim**, especially on hub/trailer cards: say only what the page
  says, not a stronger reading of it.
- **Precise in the small print:** *p = q = 2*, not *q = 2*.
- **Don't reuse another card's fact** in the same subject (check `bait.json`).

## Fields

- `title`: short, one or two fragments.
- `thumbText`: 1–3 words that **add** to the title, never repeat it. The block
  font has only A–Z, digits and `! ? . - + = % '`; accents are dropped and
  symbols like √ ∞ ≠ < are not drawn, so spell them out (`GYÖK PI`).
- `hook`: the answer, as a compact fragment; formulas welcome.
- `format`: which of the formats above the bake used (for rotation checks).

Titles never go stale: a later edit to the note does not invalidate them, and
any title can be rewritten by hand from the watch page's "⋯" menu.
