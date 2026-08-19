# Text runs — design

**What:** spans of text carrying their own look, motion pieces that apply to some letters and not
others, and a gather that collects the survivors into a word.
**For:** whoever implements this in `@blitsklieg/core`.
**Answers:** how a caller styles part of a string, how a piece addresses a subset of letters, and
what a letter needs to know to travel somewhere absolute.

**Status: draft, written without the owner.** Four decisions were made alone and are marked
**[OPEN]**. They are the ones worth overturning before anyone writes code.

## The target

An acrostic. Each line of a poem has its first letter in its own colour. On command, everything
except those letters exits; the first letters then travel to the centre of the screen and combine
into a word.

That one effect needs three things that do not exist, and they are independent enough to ship
separately.

## What already exists

More than it first appears.

Per-letter materials landed in 0.4.0, so nothing in the renderer prevents two letters differing.
`LetterInfo` — `index`, `count`, `line`, `column`, `lineCount`, `columnCount` — is already passed to
every `MotionPiece.offset(t, letter)` call, so a piece can already behave differently per letter and
return a zero offset for letters it does not want. `PoseOffset` is an offset onto a letter's layout
position, not an absolute, so pieces compose.

What is missing is a way for a caller to *say* which letters, and a way for a letter to know where
it actually is.

## Spans

`fire()` takes `text: string`. It also accepts an array of spans:

```ts
interface TextRun {
  text: string;
  look?: Look;
  tint?: number;
}

fire(text: string | TextRun[], options?: FireOptions): Promise<void>
```

Spans concatenate in order to form the string that gets laid out — layout, wrapping and line
breaking are unchanged and unaware of spans. Each letter records the index of the span it came
from. `Word` already builds one material per letter; it now builds that material from the span's
`look` and `tint` where given, falling back to the call's own.

**[OPEN 1] Representation.** An array of objects, versus markup inside the string (`"[red]N[/]eon"`),
versus a parallel array of styles. The array is the least magic and needs no parser or escaping
rules, and a string with markup cannot carry a whole `Look` object. It is also the most verbose to
write by hand for something like an acrostic, where the pattern is regular.

**[OPEN 2] Whether a span may change `look` at all, or only `tint`.** A different `look` per span
means different materials, different decoration geometry, possibly bloom on for one span and not
another — and `bloom` is a whole-frame pass, not per letter. Tint-only is a much smaller change and
covers the acrostic. Allowing `look` is the more general answer and the one that matches "spans
carrying their own look" as originally stated.

## Addressing letters

`LetterInfo` gains the span index:

```ts
span?: number;
```

That is enough for a piece to select: a piece that exits everything except the first letter of each
line checks `letter.span` (or `letter.column === 0`) and returns a zero offset otherwise.

Rather than leave every caller writing that branch, ship a combinator:

```ts
only(piece: MotionPiece, where: (letter: LetterInfo) => boolean): MotionPiece
```

It wraps a piece so it applies where the predicate holds and is inert elsewhere. Built-in names
compose with it, so `only(EXIT.shatter, l => l.span !== 0)` is the acrostic's exit without any new
exit piece being written.

**[OPEN 3] Where selection lives.** A combinator over pieces, as above, versus a `where` field on
the slot in `FireOptions`, versus letting each piece read `letter.span` itself. The combinator keeps
`FireOptions` unchanged and composes with layering, since a slot already accepts an array of pieces.

## Absolute travel

This is the part with a genuine hole.

`PoseOffset` is an offset onto the letter's laid-out position, which is what makes pieces compose
and what stops a stagger from collapsing the word. But a letter cannot currently compute *where it
is*, so it cannot compute the offset that would take it somewhere absolute. A gather needs exactly
that: every surviving letter must move to a shared destination, which is a different offset for each
one.

`LetterInfo` gains the letter's laid-out position, in em, relative to the block's centre:

```ts
/** Layout position in em, relative to the block centre. Add the negation to travel to the centre. */
x: number;
y: number;
```

`Word` already computes these — `baseX` and `baseY`, after the per-line centring shift. They are
simply never handed to the motion system.

With that, a gather is an ordinary piece: interpolate each letter from its own position toward a
shared target, and it needs no privileged access to anything.

**[OPEN 4] What "combine into a word" means precisely.** Letters arriving at one point overlap. The
acrostic wants them to form a readable word, which means they must arrive at *different* points —
laid out as a new word, in span order, centred. That is a second layout pass over a subset of the
letters, which is more than a motion piece can do with an offset alone: the destination depends on
the widths of the other survivors. Either `Word` computes the gathered layout and exposes each
letter's destination through `LetterInfo`, or the gather is a distinct mechanism rather than a
`MotionPiece`.

This is the one that most needs deciding before code, because it decides whether gather is a piece
or a new concept.

## Testing

Vitest has no GL context, so the GL-free assertions are:

- Spans concatenate to the same string the plain form lays out, and produce identical layout.
- A letter's `span` index matches the span its character came from, across a wrap and a newline.
- Per-span `tint` reaches that letter's material and no other's.
- `only()` returns a zero offset outside its predicate and the wrapped piece's offset inside it.
- `LetterInfo.x`/`y` match `Word`'s computed layout positions, including the per-line centring.
- A letter at the block centre gets `x === 0`.
- Gather: every selected letter's final pose lands on its destination, and unselected letters are
  untouched.

Visual verification is the acrostic itself in the lab.

## Deferred

**Per-span motion.** A span carrying its own enter or exit, rather than only its own look. The
combinator covers the acrostic; per-span slots are a bigger API question.

**Bloom per span.** Bloom is a whole-frame pass. A span asking for bloom would have to promote it
for the entire effect, which is surprising enough that it should stay out until someone wants it.

**Rich text.** Line breaks, alignment and wrapping already exist and are span-unaware, which is
correct. Anything beyond runs of style — inline sizing, baseline shifts, mixed fonts — is a
different project.
