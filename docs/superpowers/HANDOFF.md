# Handoff — blitsklieg, 2026-08-20

**For:** the next session picking this up. **Answers:** what is on `main`, and what is worth doing
next.

## State

**`main` carries the tube lab, the tube geometry rewrite and the colour gradients, all merged.**
`npm run check` green at 723 tests; `npx playwright test` green at 24. No code is in flight.

**[Direct tube paths](specs/2026-08-20-direct-tube-paths-design.md) is specced and not started.** It
replaces the distance field with a trace of the glyph's own contour, and it subsumes the bend-minimum
failures below — read it before picking up either. `TubeSpec.pathSource` (`field` | `exact` |
`direct`) is already in the tree, defaulting to `field`, and the tube lab's rail switches it.

**A run's colour now renders.** `assign` had always set `run.color` and nothing ever read it —
`word.ts` gave every lit run one shared material, and both looks hid it by setting `colors` to the
value the material already carried. The sweep writes a per-vertex `runColor` attribute and
`tint.ts` patches the look's own channel from it: emissive for `tubing`, base colour for `piping`,
since three's `vertexColors` only reaches diffuse. `TubeSpec.surfaceColors` is new public API, a
palette per surface. All 24 baselines pass unchanged, which is the claim that published looks did
not move.

**`TubeSpec.gradient` ships.** A colour sweep with six domains, in `replace` or `modulate`; the
[design](specs/2026-08-20-colour-gradients-design.md) has the domain table. Neither shipped look
sets it, so every run is still flat and all 24 baselines are unmoved. A domain is evaluated wherever
its context already lives: `runIndex` and `surface` resolve in `assign` into `run.color`, touching
neither geometry nor shader; `run` and `letter` write a `gradientT` attribute in `sweep.ts`; `axis`
and `radial` are computed in the vertex shader. All six read one ramp texture, which the `Word` owns
and disposes — `material.dispose()` cannot reach a texture that lives only in a uniform
`onBeforeCompile` added. `spikes/gradient-presets.mjs` draws every preset as an SVG page, and stops
get tuned there before a look changes. With bloom on the glow fills a dim run end, so the
`electrode` preset reads close to flat at panel size; that is the interaction, not the ramp.

The geometry model is in `docs/superpowers/specs/2026-08-19-tube-geometry-design.md`, and its
`## Acceptance, as measured` section has the numbers. In short: the tube holds one diameter, corners
are classified by bend radius and filleted with a tangent arc at the material's minimum, run ends are
sealed, a corner can carry the tube past the light unlit rather than cutting it, and the loop
strategy is gone. Two runs of 231 on `tubing` and three of 47 on `piping` still bend tighter than
their look's minimum, against every `piping` run clamped before.

Run it with `npm run dev:tube-lab -w blitsklieg` — sixteen panels on one WebGL context, one letter
each, `beauty` / `skeleton` / `ramp`, with a rail that tunes the whole `TubeSpec`. Every control
carries a hover hint saying what it does and what it interacts with badly, which is the fastest way
back into the model. Sliders that mark a real boundary have a stop the drag catches.

**Some rail controls are honest about very little, and the hints say so.** `runs` is a request
pinned between the corner count below and `minRun` above — at `bend` 4 it is pinned across its whole
range. `wall depth` and `wall rise` do nothing under either shipped look, both being front-only, and
the `surface` gradient domain is inert for the same reason. A positional gradient's bounds are per
`Word`, and every panel is its own one-letter word, so an `axis` sweep restarts in each panel rather
than running across the grid. `spikes/slider-sensitivity.mjs` sweeps every field and counts distinct
outputs; use it before believing a control does what its name says.

The spikes are the fast way back into any of it: `bend-acceptance.mjs` is the invariant across the
alphabet, `where-under-bend.mjs <look> <letters>` says whether a bad bend is inside a fillet, at a
join, or on plain path, `run-vertices.mjs` dumps one run, `corner-width.mjs` measures corner
stretches against a synthetic control, and `fillet-view.mjs` draws the corner stage's decisions as an
SVG page. For the path source work: `join-geometry.mjs` dumps a failing run per vertex,
`source-shootout.mjs` is the acceptance across all three sources, and `run-decomposition.mjs` shows
how the source changes the cut. The spec lists the rest.

## What is worth doing next

Roughly in order of value. Only the first two are entangled — the bend-minimum defect gates path
fidelity, and the spec covers both; the rest are independent.

- **Path fidelity — specced, and it starts with the fillet junction.** The field displaces the path
  a mean of 4 to 7 percent of the tube radius. The flattening it rasterises is not at fault and
  measures 0.00000 em; the grid is the whole of the loss. The spec has the plan and the numbers.
- **A limb-brightening rim** on the tube material. Flat emissive renders a cylinder as a ribbon. The
  last unbuilt look item from tubing, and the owner rated it a bonus rather than the point.
- **`pyrite` is built on the wrong model and should be respecced before it is tuned.** See below.
- **The runs under the bend minimum are one defect, and it is diagnosed.** Every one of them sits at
  a fillet-to-path junction: the arc is sampled at half `spacing` and the legs at `spacing`, and the
  leftover segment carries the whole residual turn at one vertex. Under the grid that reads as a 22
  degree turn at 1.91r; under an accurate path the leg's last point lands inside the setback and the
  path reverses, 174 degrees at 0.32r. `spikes/join-geometry.mjs` prints a failing run per vertex.
  This is not independent of path fidelity — it gates it, because the grid's blur is what was
  holding it to a few percent.
- **`sequin` and `pyrite` both waste ~30% of their chunk pool on the back cap** (`decoration.ts:227`).
  Rejecting back-facing samples changes which pool indices exist, so it changes how both published
  looks render. That is a decision, not a patch.

## What was learned that is not in the plan

- **`M` and `W` are the worst case, not `N`.** The standing `NSRE` string missed both extremes: `M`
  bends at 0.32 of its own tube radius and `W` at 0.38, against `N`'s 0.44. Every acceptance check
  uses `MWNSRE`. The tube lab's default letters are `MWSB` for the same reason.
- **`ρmin` sits above `ρstyle`, and the spec's two-class model breaks on it.** At `bend = 2` the
  stylistic band is empty, and a corner between `ρstyle` and `ρmin` is hard yet above the detection
  threshold — never seen, never fixed, silently violating the invariant. 13 such corners on `tubing`
  at `bend = 2`, **174 at `bend = 3`**, widening linearly, so the failure got worse exactly as
  someone tuned toward stiffer material. Detection now runs at `max(ρmin, ρstyle)`. A genuinely
  stylistic class requires `bend < 1.76`, not a change to `ρstyle`.
- **`bend` does not classify — it sets setback.** 2 and 3 give near-identical hard-corner counts.
  What moves is the fillet setback and so the fallback rate. Tune against the rejected-fillet count,
  never the corner count.
- **Filleting is the ordinary path**: 228 hard corners on `tubing` and 244 on `piping`, across all 26
  letters of both. Robustness in the common case, not correctness in the rare one.
- **A corner is a stretch because of resampling, not because of the field.** `spikes/corner-width.mjs`
  measures a square with no distance field anywhere near it: arc-length resampling splits a perfectly
  sharp corner across two vertices whenever a sample does not land on it, which is the generic case.
  The direct contour carries the same stretches, and the same 20-degree shoulder outside them. Group
  filleting is needed at either fidelity, and **path fidelity neither blocks nor is blocked by this
  work** — the ordering question the spec reopened is closed.
- **The corner keeps turning past its stretch.** That shoulder is why a leg direction is averaged over
  four segments rather than taken from the segment next to the corner.
- **The field manufactures corners, so a path source change is a look change.** Its wobble creates
  corners that are not in the glyph, every corner is a candidate break, and stripping it roughly
  halves the corner count. The cut then lands elsewhere and `assign` paints a different lit pattern
  from the identical seed — tubing's `S` goes `OxO.xO` to `OO.OOx`. A look reads differently under a
  different source even though its path is the same shape, so numbers tuned against one do not carry
  to the other. `spikes/run-decomposition.mjs`.

## Traps

**Eliminate a cheap hypothesis about render state before an expensive one about geometry.** The tube
vanishing when thinned was diagnosed twice as a geometry bug and was one line of render state: a
`transparent` material still writes depth by default, so tubing's 0.08 backing was culling its own
tube. `519ae45` has the detail.

**`tightestBend` smooths three times before measuring**, calibrated for the distance field's
staircase noise. On a coarsely sampled arc it shrinks the radius about a tenth — enough to fail the
invariant it is checking. Fillets are sampled at half `spacing` for that reason, and authored points
are held out of the smoothing entirely (`markAuthored` / `isAuthored` in `bend.ts`). Anything else
that builds exact geometry into a run needs the same care.

**Smoothing masks raw kinks.** Holding fillet points fixed made joins fail that had looked fine,
because the filter had been rounding them off. A green measurement through a smoother is not evidence
the path is clean.

**A room test measured on geometry the merge does not build passes on nothing.** The fillet was
computed twice from different inputs, so the check validated an arc that was never spliced.

**Trimming a leg back by accumulated step length leaves a point *inside* the setback**, so the path
runs forward to it and then jumps back to the tangent point. That reversal reads as a *tighter* bend
than the corner it replaced. Trim by distance from the corner instead.

**A test fixture's sampling spacing is load-bearing.** Bend radius is `s / (2 sin(θ/2))`, so a 90°
turn at 0.1 spacing is a 0.071 em bend — wider than a 0.03 tube need bend, and no corner is found at
all. Sample fixtures at the pipeline's own 0.02.

**A per-pixel `threshold` is what decides whether a visual baseline can see a change at all**, and
the pixel-count ratio cannot substitute for it. Playwright's default 0.2 hid bloom entirely.
`--update-snapshots=all` rewrites **every** baseline, so grep to the ones that move.

**The visual suite cannot see `piping`'s cord.** It traces inset at `level: -0.015`, so the cord is
inside the letter body in both framings and both its baselines are blind to the change that matters
most for that look. Judge piping by `spikes/bend-acceptance.mjs` or a lab capture.

**A bloomed look at DPR 2 can exhaust Playwright's default 5s screenshot budget** while the stability
loop waits for two consecutive frames. `shoot()` passes `timeout: 20000`, and an occasional single
failure on `tubing` is this rather than instability — re-run before believing it.

**A positional gradient's bounds must be mutated, not reassigned.** The compiled shader aliases the
`Vector4` and `Vector2` sitting in `material.userData`, so a `regroup()` that hands over fresh
vectors leaves every already-compiled letter reading the pre-regroup mapping.

**The per-vertex gradient parameter is arc length, not ring index.** `ringsOf` domes each end with
4 cap rings covering about one `radius` of length, so a ring-index parameter gave a 25-point run 25%
of its range on caps that are 11% of it, and the share moved with point density. Ring index squeezes
`electrode`'s dim ends onto the domes.

**Never add `opacity` to `LookKey`.** `Word` rewrites `material.opacity` every frame, so a value
applied through `PARAM_KEYS` is gone by the first tick — and it would pass any test that never calls
`apply()`.

**Do not `git add -A`**, and do not chain `npm run check && git commit` through a `grep` — the grep
succeeds and the failed check is swallowed.

## Verify by mutation

The tube lab plan's two-stage review found a defect on all nine of its tasks, and the single
highest-yield instruction was "verify this by mutation". It has held on everything since:

- Two tests written for the geometry work passed with the code under test **deleted**. A closed-path
  seam test needed a superellipse sampled finely enough that corners span several vertices before it
  could bite; a square with single-vertex corners never straddles the seam at all.
- A `report.ts` predicate comparing bend radius against the *tube radius* instead of `ρmin` returns
  plausible booleans rather than failing, on the very panel used to judge whether the model worked.
  There is now a test whose fixture sits between the two so it discriminates.
- The plan's own mutation instruction for the wander cap had the direction backwards: `budget` is in
  the denominator, so raising it *tightens* the cap. Corrected in the plan.
- The path source work reached both its findings by a wrong turn first: the junction defect read as
  a fidelity problem, and the contour offset's first fix broke the outer contour instead of the
  counter it was aimed at. A number that agrees with the hypothesis is not evidence until the code
  under it has been deleted and the number moved.

## windease: the workaround has an expiry date

`packages/core/dev/tube-lab/src/tree.ts` exists because `splitStrategy` in windease 0.8 cannot tile —
`initialState` builds a right-leaning spine, and at sixteen panels nine panes land at zero-or-negative
width. It also silently drops a panel its tree does not know about.

**Upstream has since replaced `splitStrategy` entirely**: `stripStrategy` plus a `store.split(id,
input)` verb, with resize writing to `membership.placement.size`. That fixes both bugs and the missing
drag-to-rearrange. We are pinned at `windease@^0.8.0`, so nothing breaks today, but upgrading deletes
`tree.ts` and rewrites the seeding — do it deliberately.

## `pyrite` is built on the wrong model

The chunk generator samples surface points and sticks a chunk on each — dip it in glue and roll it in
sprinkles. That is right for `glitter` and roughly right for `sequin`, which genuinely are applied to
a surface. Pyrite is *intergrown*: cubes grown out of the matrix, mostly buried, penetrating each
other, faces parallel within a grain because they share a lattice.

More crystals will not fix that. Three changes to the placement model would do more than raising the
count 30x: **vary size** (crystal beds are power-law, and that scale variation is most of what makes a
texture read as grown rather than applied); **vary embedding** (`proud` is one value for every chunk,
so all of them sit the same fraction out, which is precisely the glued look); and **allow
interpenetration** (`chunkMatrices` draws sample points without replacement, so chunks can never
overlap — combined with the existing `align`, overlap is what turns scattered dice into one mass).

If a respec still leaves it not worth shipping, killing it is the owner's call — but note that is a
breaking change, since `pyrite` has been in the published `LookName` union since 0.4.0. Separately,
`POOL = 512` in `decoration.ts` bounds distinct positions for both chunk looks, and the clustering
draw scans the whole pool per chunk, so raising it makes placement quadratic.

## A known limitation of the lab

A spec change rebuilds all sixteen cells, ~1.45s front-only and ~2.85s with `back`/`wall`/
`connectors`. Sliders commit on release, so a drag costs one rebuild rather than twenty — but a single
step still waits. The honest fix is not rebuilding a whole `Word` per cell for a spec change.
