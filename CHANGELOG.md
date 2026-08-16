# Changelog

## Unreleased

### Tint

`tint` recolors any look to your own color, keeping the rest of the material. It is routed to
whichever property carries that look's hue — the base color for the metals, attenuation for
`ruby`, whose red comes from what light picks up passing through it rather than from its base
color.

## 0.2.0

### Multiple lines

`\n` in the text breaks a line, and each line centers on its own. `wrap: true` additionally
chooses breakpoints for you, picking whichever arrangement renders *largest* rather than fitting
to a column count — so it wraps only when wrapping makes the type bigger, and short text stays on
one line. Words are never split.

A newline is now consumed as a separator rather than laid out, so it no longer renders as a
`.notdef` box mid-word.

### Holding until dismissed

`hold: 'click'` keeps an effect on screen until the viewer presses a pointer or Escape, then
plays the exit normally. The dismissing click passes through to your page by default; `modal:
true` makes the overlay swallow it instead. Under the default `queue` policy a held effect blocks
later fires — use `replace` if a later effect should cancel it.

### Writing your own motion

`enter`, `active` and `exit` now take a built-in name, a `MotionPiece` you built, or several
layered together (`active: ['float', 'shimmer']`).

- `transition(duration, spec)` builds an arrival or departure from `from`/`to`/`keyframes`, with
  `ease`, per-channel `easeBy`, and `stagger`.
- `cycle(duration, spec)` builds a looping idle from per-channel `amplitude`, `harmonic` and
  `phase`. `envRotation: true` rakes the environment highlight, which is what `sweep` does.
- `spring({ stiffness, damping, mass })` returns a closed-form easing curve, so it stays a pure
  `(t) => number` and goes anywhere an easing goes.
- Stagger takes `spread` or `each`, and `from: 'start' | 'end' | 'center' | 'edges' | 'random'`.
  `grid: true` measures the order radially over a multiline block.

`Easing` is exported and is `(t: number) => number`, which is also `d3-ease`'s signature — bring
any curve library you like. blitsklieg still depends only on `three` and `opentype.js`.

All thirteen built-in pieces were rewritten on this vocabulary and are unchanged to within 1e-8,
pinned by a golden fixture.

### Internal

`poseAt` writes into a caller-owned pose instead of allocating roughly ten objects per letter per
frame. A timeline slot holds layers, which is what lets two active pieces run at once.

## 0.1.0

First release.
