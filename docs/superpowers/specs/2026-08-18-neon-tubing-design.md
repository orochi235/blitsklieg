# Neon tubing — design

**What:** a replacement generator for the `tubing` look, building runs of glass tube across the
surfaces of an extruded glyph instead of tracing its outline.
**For:** whoever implements this in `@blitsklieg/core`.
**Answers:** where tube paths come from, how a path becomes a set of separate runs, and which of
those runs light up.

`tubing` today sweeps a closed loop along each glyph contour. That reads as stroked line-art
because a real sign is not one continuous line per letter — it is a handful of bent tubes with
ends, gaps and unlit glass. This respecs the geometry. The look's name, material and bloom
settings are unchanged, and `neon` is untouched.

## The pipeline

Five stages. Each is testable without a GL context, and each depends only on the stage above it.

| Stage | In | Out |
|---|---|---|
| Surfaces | glyph shapes, extrude depth | surfaces with 2D coordinates |
| Generators | one surface | 3D polylines |
| Cutting | polylines | the run list |
| Assignment | the run list | lit flag and color per run |
| Sweep | lit runs | tube geometry |

## Surfaces

An extruded glyph is a prism. Its surface splits into the front face, the back face, and one wall
per contour — so `S` has one wall, `O` two, `B` three.

Every one of these can be given 2D coordinates without distortion, which is the only property the
generators need. Faces use x/y directly. A wall uses arc length along the contour by depth; it
wraps, so arc length is modulo the perimeter.

**The wrap is a trap.** A run crossing arc length 0 on a wall reads as jumping the full width of
the letter unless the generator wraps deliberately. It produces a plausible-looking wrong path
rather than an error.

## Generators

A generator lays paths out in one surface's 2D coordinates and returns 3D polylines. Every
generator ships; a look enables a subset.

**Face generator — the distance field.** Rasterise the glyph silhouette, run an exact Euclidean
distance transform, sign it inside-negative, and take an isocontour by marching squares. The
level is the parameter, in em:

- negative insets the path into the letter,
- zero rides the outline,
- positive stands the path off the type,
- deep negative collapses onto the stroke centerline.

One generator therefore covers inset paths, outline paths, standoff paths and the medial-axis
centerline, which the 0.4.0 design listed as four separate deferred items.

It also removes a failure mode rather than handling it. `insetContour` walks vertices along angle
bisectors, which turns inside out past a pinch, so it detects the reversal and discards the whole
contour — one bad vertex in an `A`'s crotch loses the glyph. A level set cannot self-intersect.
Ask for an inset deeper than the letter is thick and paths drop out one at a time and then stop
existing, which is valid output.

`spikes/tube-paths.mjs` implements this end to end and is the reference for the arithmetic.

**Wall generator.** Paths in arc length by depth. A constant depth gives a band running around
the letter's edge; a varying one gives tube that rises and falls across the wall.

**Connectors.** Short runs joining a path on one surface to a path on another, mostly travelling
in z. These are the returns that dive back through the backing, and they are the reason runs are
3D polylines rather than planar paths carrying a depth profile — a depth profile on a planar path
can vary depth but can never point along z.

## Cutting

A generator's output is closed or open paths. Cutting turns them into runs.

**Corners cut, always.** A corner is a tangent break above a threshold — G¹ discontinuity. Glass
bends but does not kink, so a corner ends one tube and starts the next. Measured on the lab font:
`O` is 2 spans, `S` 4, `I` 4, `E` 12, since every join in an `E` is a right angle.

**`runs` subdivides.** A count, not a length. Extra cuts are distributed across spans by length,
largest remainder, at least one piece per span. Total outline length per glyph sits between 3.4
and 4.3 em across the alphabet, so the same count behaves consistently letter to letter.

`runs` is a request, not a guarantee: it cannot go below the corner count, and the floor below can
take it lower still. `S` asking for 9 yields 7.

**`minRun` is a floor.** Spans between corners range from 0.004 em to 2.35 em on this font, and a
run shorter than the tube is wide is a bead, not a tube. Anything under the floor is dropped and
left dark — which is what real neon does, and the dark stretches are part of the look rather than
a defect.

## Assignment

Both levers are an ordering plus an amount over the run list, so every combination is meaningful.

**Selection** decides which runs light. The ordering is by seed, by length, or by index; the
amount is a fraction or a count. All-lit is fraction 1.0, a worn sign is a seeded 0.6, and
longest-five is length-descending at 5.

**Color** is a palette plus an assignment rule. The palette cycles across runs, so any palette
length works, one included.

Both run on the run list and neither knows how the runs were made.

## Sweep

Lit runs sweep into tube geometry. Unlit runs sweep identically with a dark-glass material rather
than being skipped, so an unlit stretch is visibly present glass.

**Radius must taper against curvature.** A sweep whose radius exceeds the path's local radius of
curvature turns inside out. This is real and not rare: after resampling, the tightest radius on
`R`'s outline level set is 0.0132 em and on `E`'s +0.045 set is 0.0040 em, against a shipping tube
radius of 0.045 em. The `minRun` floor does not save it — a run can be long and still contain one
tight corner, and measurement confirms tight paths clear the floor at nearly every level. Measure
curvature during resampling, where it is free, and reduce radius where the path cannot carry it.
Thin glass bends tighter, so a taper is also the physically honest answer.

## Resolution

`CONTOUR_SEGMENTS` is deleted. It reaches `Shape.getPoints()`, which subdivides *per curve* with
straight lines fixed at one, so its meaning depends entirely on how a font authored a glyph. On
the lab font that yields 5 points for `I` and 1253 for `S` — a 250× spread from a 3.5× difference
in structural complexity, because nine of fourteen sampled capitals contain no curves at all.

Paths are resampled at fixed arc-length spacing in em, so point count tracks length. The spike
measures 63 to 208 points per level set across every glyph and level.

Resampling also smooths. Marching squares emits staircase noise at grid scale, and curvature
measured before smoothing reports the raster rather than the glyph — by a factor of 5 to 30.

**`glyphToShapes` emits zero-length `LineCurve`s** between curve pairs: 12 of `S`'s 42 segments,
8 of `O`'s 26. `getTangent` returns `(0,0)` on those, which reads as a 90° corner and would cut a
run at every one. Filter them before any tangent test.

## The run list

The run list is the public seam. It is ordered and addressable, and each run carries its polyline,
its surface, its generating parameters, its arc length, its lit flag and its color.

Everything above the seam generates; everything below consumes. This is the one structural
commitment worth making now, because it is what lets each deferred item below arrive without
touching a generator.

**Runs must be stable across frames** — seeded and order-stable, so that "run 7" means the same
run every frame. A post-effects layer addressing runs by index breaks silently otherwise.

## Types

`TubeSpec` is replaced. `radius`, `segments` and `look` survive; `at` and `inset` do not — depth
is a property of a run, and inset is the face generator's `level`.

```ts
type SurfaceKind = 'front' | 'back' | 'wall';

interface TubeSpec {
  kind: 'tube';
  radius: number;              // em, tapered down where curvature demands
  segments: number;            // ring segments around the tube
  spacing: number;             // em between resampled points
  surfaces: SurfaceKind[];     // which generators run
  level: number;               // em, face generator isocontour level
  runs: number;                // requested run count per letter
  minRun: number;              // em, below this a run is dropped and left dark
  select: { by: 'seed' | 'length' | 'index'; amount: number; stride?: number };
  colors: number[];            // cycles across lit runs
  look: MaterialSpec;
  dark: MaterialSpec;          // unlit glass
}
```

A mode is a named `TubeSpec` preset, not a separate type.

## Where the numbers come from

Placeholders ship, and every parameter gets a lab slider with its range scaled to the look, read
off the lab once it looks right — the way glitter's grain and density were. `level`, `runs` and
`select.amount` are the three that change the character most.

## Testing

Vitest has no WebGL context, so the GL-free assertions are:

- A level set at any value is closed and non-self-intersecting, and deepening the level reduces
  the path count monotonically to zero.
- Resampled point count tracks arc length, and does not vary with a glyph's curve count — `I` and
  `S` at equal path length get comparable point counts.
- Corner cuts land at tangent breaks, with zero-length segments filtered: `O` gives 2 spans, `E`
  gives 12.
- `runs` below the corner count returns the corner count; above it, the floor bounds the result.
- Runs shorter than `minRun` are absent from the lit set and present in the dark set.
- Selection and color are deterministic per letter seed, and stable across two builds.
- A wall path crossing the arc-length seam is continuous in 3D.
- Swept radius never exceeds local curvature radius.
- `dispose()` releases every geometry and both materials.

Visual verification is a Playwright screenshot in the lab, as today.

## Deferred

**Off-axis capture.** A depth-varying run is invisible head-on and idle yaw is only ~0.1 rad, so
the visual baseline cannot see most of what this spec adds. Wanted: a contact sheet of several
viewpoints, built by yawing `word.group` between captures rather than by moving the camera —
`viewportBudget()` treats `camera.position.z` as the distance to the word plane, so an off-axis
camera drifts the fit until that is reworked.

**Post-effects over the run list.** Blinking segments and simulated wear are a layer that
modulates the lit flag, statically or per frame. Because unlit runs already carry geometry,
switching one is a material swap with no rebuild.

**An editor.** Runs go in as generated and the editor joins and splits them. The run list is
already the right input; nothing else is designed.

**Physics-driven bending.** Solving a run as an elastic curve with real bend-radius limits,
rather than following a generated path. A different generator, and it needs the run decomposition
to exist first.

**Per-letter color and styled text runs**, unchanged from 0.4.0: `fire()` takes one `tint` for the
whole word, and spans of text carrying their own look is a text API question, not a looks one.
