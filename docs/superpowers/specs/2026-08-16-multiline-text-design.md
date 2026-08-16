# blitsklieg — multiline text and indefinite hold

**What:** two additions to `fire()` — text that renders on more than one line, and an effect that
holds until the user dismisses it.
**For:** anyone working on blitsklieg core. Assumes the v0 design doc.
**Answers:** how lines are chosen and positioned, how a held effect ends, and what stays unchanged.

## Public API

Three new fields on `FireOptions`. Nothing existing changes shape.

```ts
hold?:  number | 'click'   // 'click' holds the active phase until dismissed
wrap?:  boolean            // default false — auto-wrap to the largest legible arrangement
modal?: boolean            // default false — only meaningful with hold: 'click'
```

A `\n` in `text` always breaks, with or without `wrap`. `wrap` additionally re-breaks lines that
are still long. Existing calls render exactly as they did in v0, which is the reason `wrap` is
opt-in rather than automatic: an argmax rule applied by default silently turns some one-line
effects into two-line ones on upgrade.

## Layout

`layoutLine` is unchanged. Two pure functions join it in `text/layout.ts`, both taking
`GlyphMetrics` rather than a font so they test against stubs:

```ts
export interface Block { lines: Line[]; width: number }   // width = widest line

export function layoutBlock(text: string, metrics: GlyphMetrics): Block
export function wrapBlock(
  text: string,
  metrics: GlyphMetrics,
  budget: Budget,
  unitsPerEm: number,
): Block
```

`Word` calls `wrapBlock` when `wrap` is set and `layoutBlock` otherwise, so its constructor takes
the flag alongside the budget it already receives.

`unitsPerEm` is not decoration. Line widths arrive from `layoutLine` in font units while leading
is expressed in em, and scoring the two against each other without converting silently prefers
arrangements that are far too tall — a 1000-unit em makes one line of leading outweigh a whole
line of text by three orders of magnitude.

`layoutBlock` splits on `\n` and `\r\n` and runs `layoutLine` per segment. The separator is
consumed rather than laid out, so it never reaches `charToGlyph`.

`wrapBlock` searches for the arrangement with the largest `fitScale`. Searching line *counts*
turns combinatorial once explicit segments are in play, so it searches a single candidate
maximum line width instead:

1. Candidates are the widths of every contiguous word-run within every segment, deduped.
2. Greedy-wrap all segments to that width and concatenate the result.
3. Score `fitScale(maxLineWidth, lineCount × LINE_HEIGHT_EM × unitsPerEm, budget)`, both terms
   in font units.
4. Take the largest scale; tie-break to fewest lines, then narrowest.

One dimension, deterministic, quadratic in a word count that is realistically under ten. Words
are never split — a word wider than the budget keeps its own line and shrinks the block.

The tie-break carries more weight than it looks. `fitScale` caps at 2.2, so short text is already
at the cap on one line and gains nothing by breaking; the tie-break is what keeps `JACKPOT!`
from arriving as two lines.

Lines are center-aligned. `fullscreen` placement is centered already, and ragged-left display
type over a page reads as a bug.

`LINE_HEIGHT_EM` is 1.1 — display capitals want tighter leading than the 1.2 that suits body
text. It is the only tunable number here.

## Rendering

`Word` gains `baseY`, parallel to the existing `baseX`, holding line *i* at `-i × LINE_HEIGHT_EM`.
Each line centers on x independently, so its glyphs take `x = pen − lineInkWidth / 2`.

```ts
mesh.position.y = (this.baseY[i] as number) + pose.position[1];
```

That line is the whole feature's failure mode. `apply()` currently assigns pose y outright, and
a layout y written anywhere else is erased on the first frame of every motion — the same trap
the existing comment warns about for x, which is why x has always been an offset. Silent: the
lines simply stack into one.

Block centering and `fitScale` then run over real geometry ink bounds across every line, as v0
does across one.

## Stagger

Unchanged. `letters` is flat in reading order, pushing line by line keeps it that way, and
`index` / `count` continue to span the whole block. `LetterInfo`, `stagger()` and all 13 motion
pieces are untouched. Newlines never become slots, so they do not inflate `count`.

## Indefinite hold

`Timeline` gains `release(elapsed)`, pinning the active phase's end to the dismissal moment;
exit then plays normally. Before release `duration` is `Infinity` — which the existing
`Math.min(Math.max(since, 0), duration)` in `run()` already handles — and `isFinished` is false.
The reduced-motion path waits on release rather than on `since >= hold`.

Dismissal listens for `pointerdown`, not `click`, so a drag that begins over the overlay cannot
leave it stuck. Escape releases as well.

**`modal: false`** leaves the canvas `pointer-events: none` and listens on `window` in the
capture phase, passive, without `preventDefault`. The dismissing click also lands on whatever
is underneath it.

**`modal: true`** flips the canvas to `pointer-events: auto` for the hold. It is fullscreen and
on top, so it takes the whole click sequence and the page sees none of it — the one state in
which blitsklieg is not click-through. Escape matters here: without it a full-viewport overlay
that swallows input and never times out is a keyboard trap.

Listener teardown and the `pointer-events` restore belong inside `settle()`, which abort and
`destroy()` already route through.

Two consequences for the README. Under the default `queue` policy a held effect blocks every
later `fire()` until it is dismissed; `replace` cancels it instead. And its promise stays
pending, consistent with resolving when the effect leaves the screen.

## Lab

`<input id="text">` becomes a two-row `<textarea>`. Enter still fires — Shift+Enter breaks the
line, the convention every chat box uses. New `wrap` and `hold until click` checkboxes, plus
`modal`, disabled unless hold-until-click is on. The checkbox overrides the `hold` number field.

## Non-goals

Hyphenation, per-line alignment control, justified text, and bidi. A right-to-left script needs
more than a layout flag and there is no consumer asking.

## Testing

Vitest over what fails silently:

- `wrapBlock` against stub metrics — tie-breaks, a word too long to break, `\n` and `wrap`
  together, trailing and blank lines.
- `wrapBlock` picking the same arrangement at 1000 and 2048 units per em, which fails the moment
  the width and leading terms drift out of the same unit.
- `layoutBlock` newline handling, `\r\n` included.
- `Word` proving pose y adds onto `baseY` instead of replacing it.
- `Timeline.release` before and after, and that `isFinished` never fires while held.

One Playwright screenshot of a two-line block at a fixed clock.
