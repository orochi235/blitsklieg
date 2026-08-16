# Changelog

## 0.3.0

### Breaking

`ruby` is now `gem`, with no alias. It also gained `dispersion`, which splits transmitted light
into rainbow fringes at the edges — the reason the name changed.

`sweep` has left `active`, and `active` now defaults to `'none'`. It never contributed a
transform; it existed only to tell the stage to rotate the environment. Living in a motion slot
also meant its period came from whatever the longest layered sibling happened to be, so
`active: ['float', 'sweep']` silently stretched its tuned 3400ms to 5200ms.

The minimum Node version is now 24.

### Lighting

`lighting` is its own option, orthogonal to all three motion slots and running across the whole
timeline rather than the active phase. `sweep` rakes the highlight on its own period, `static`
holds the environment still. It defaults to `sweep`, so the type stays lit whatever the motion
is doing.

A piece built with `cycle({ envRotation: true })` still drives the environment, and overrides
the option while it is active.

### Six looks

`velvet` is a matte nap that lights up at grazing angles. `neon` glows, and turns the bloom pass
on by itself unless you pass `bloom: false`. `flake`, `glitter` and `leather` share one
procedural shader that cuts object-space position into jittered voronoi cells — a plain lattice
sliced by a flat glyph face reads as a pixel mosaic at any scale.

`flake` and `glitter` sparkle by sharpening each cell into a tiny mirror, so only the few
aligned with the environment blaze while the rest stay dark. `leather` uses the same cells as
upholstery panels instead, each bulging slightly and creased where it meets its neighbours.

Each letter seeds its own flake field, so repeated letters do not sparkle in lockstep.

### Materials of your own

`look` now takes a plain object as well as a name — every field a number, no three types in your
signatures. Out-of-range values clamp rather than throw. `tintTarget` overrides which channel
`tint` writes to when the default routing guesses wrong.

## 0.2.1

### Fixed

Mixing names and pieces in one layered slot — `active: ['sweep', myShimmer]`, which the 0.2.0
README documented — was rejected by the types and broken at runtime: names inside an array were
passed through unresolved, leaving a bare string where a piece was expected and turning the
slot's duration into `NaN`. Arrays now accept either and resolve names in place.

The install notes now mention `@types/three`, which TypeScript consumers need because three
ships no declarations of its own.

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

### Tint

`tint` recolors any look to your own color, keeping the rest of the material. It goes to
whichever property carries that look's hue — the base color for the metals, attenuation for
`ruby`, whose red comes from what light picks up passing through it rather than from its base
color.

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
