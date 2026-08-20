# Handoff — tube geometry, 2026-08-20

**For:** the next session picking up the tube geometry work. **Answers:** what landed overnight,
what is left, and the two defects standing between here and acceptance.

The spikes are the fast way back in: `bend-acceptance.mjs` is the invariant across the alphabet,
`why-under-bend.mjs` separates the corner strategies, `where-under-bend.mjs` says whether a bad bend
is inside a fillet, at a join, or on plain path, `run-vertices.mjs` dumps one run, `corner-width.mjs`
measures corner stretches against a synthetic control, and `fillet-view.mjs` draws the corner stage's
decisions as an SVG page.

Read `docs/superpowers/specs/2026-08-19-tube-geometry-design.md` for the model and
`docs/superpowers/plans/2026-08-20-tube-geometry.md` for the steps. This file is a pointer to those
plus what they cannot carry.

## Where the work is

Branch `tube-geometry`, unpushed, in the worktree `.claude/worktrees/tube-geometry`. Based on
`tube-lab` at `6bb0994` — the tube lab is finished and was built by a second session in the main
checkout; both branches are clean and disjoint.

`npm run check` green at **636 tests**, nothing half-built in the tree.

**Tasks 1–7 of the nine are committed and task 7 now meets its acceptance criterion.** Task 8 was
attempted and reverted; what it cost is written into the spec rather than left in the code.

| | |
| --- | --- |
| 1 | `bend` as a per-look material property, floored at 1.25 |
| 2 | corners classified by bend radius, not turn angle |
| 3 | `filletAt` — a tangent arc at `ρmin` |
| 4 | `ClearanceGrid` — the spatial hash |
| 5 | wander capped so it cannot out-bend the tube |
| 6 | **the invariant**: `sweepRun` holds the requested radius; `sweepRadius` → `tightestBend` |
| 7 | fillets wired into the cut — **1 run of 168 under rho_min across the alphabet** |
| 8 | the pigtail — **attempted, reverted; see the spec's `## Loops` section** |
| 9 | acceptance and the baselines — **blocked on 8, and on the two decisions below** |

## Where the bend invariant stands

`node spikes/bend-acceptance.mjs` is the check — the whole pipeline, not just the cut, so wander is
included. A fillet is built at exactly `rhoMin`, so it tests "not below", not "strictly above".

```
tubing                       11/171 runs under rho_min   worst 0.88r
tubing no loop               25/168                      worst 1.52r
tubing no loop no wander      1/168                      worst 1.52r
piping                        3/47                       worst 1.43r
```

The corner stage is done. What is left splits cleanly: **wander owns 24** and **the loop splice owns
the rest, including every severe number**.

## Two decisions, both the owner's

**1. Wander and fillets collide, and the spec's model does not resolve it.** Wander bends in z while
the path bends in x/y, so they are perpendicular and combine as a hypotenuse. Enforce that exactly
and *any* wander on a run holding a fillet is illegal, because a fillet sits at exactly `rhoMin` with
nothing left to spend. That was built, it flattened every filleted run, and it was reverted; the
`budget = rhoMin * 2` heuristic is back and those 24 runs are what it costs. Three ways out: accept
it and lose wander on filleted runs; build fillets *above* `rhoMin` so wander has headroom, since
`rhoMin` is a floor rather than a target; or move wander ahead of cutting so the fillets absorb the
combined curvature — which the plan flagged as a choice to make rather than discover. The third is
the one to take.

**2. Is the loop worth its geometry?** The spec now carries what both pigtail constructions cost and
why neither closes. Wiring `loop` to fall back to `break` takes tubing from 46/171 under-bend to
**11/171** — already far better than the `buildLoop` that ships, at the cost of the flourish only.
Decide that before building the pigtail, not after.

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

## Traps this work hit

- **`tightestBend` smooths three times before measuring**, which is calibrated for the distance
  field's staircase noise on straightish stretches. On a coarsely sampled arc it shrinks the radius
  about a tenth — enough to fail the invariant it is checking. Fillets are therefore sampled at half
  `spacing`. Anything else that builds analytic geometry into a run needs the same care.
- **Trimming a leg back by accumulated step length leaves a point *inside* the setback**, so the path
  runs forward to it and then jumps back to the tangent point. That reversal reads as a *tighter*
  bend than the corner it replaced. Trim by distance from the corner instead.
- **A test fixture's sampling spacing is load-bearing now.** Bend radius is `s / (2 sin(θ/2))`, so a
  90° turn at 0.1 spacing is a 0.071 em bend — wider than a 0.03 tube need bend, and no corner is
  found at all. Nine pre-existing tests went red on a correct change for exactly this. Sample
  fixtures at the pipeline's own 0.02.
- **A room test measured on geometry the merge does not build passes on nothing.** The fillet was
  computed twice from different inputs, so the check validated an arc that was never spliced. Any
  test of fit has to run on the same object the caller uses.
- **The sweep's smoothing is a denoiser for the field's staircase, and it was being applied to arcs
  built analytically**, shaving 3–6% off a fillet at exactly `rhoMin`. Authored points are held fixed
  through it now (`markAuthored` / `isAuthored` in `bend.ts`); anything else that builds exact
  geometry into a run needs the same.
- **Smoothing masks raw kinks.** Holding fillet points fixed made joins fail that had looked fine,
  because the filter had been rounding them off. A green measurement through a smoother is not
  evidence the path is clean.
- **Do not `git add -A`**, and do not chain `npm run check && git commit` through a `grep` — the grep
  succeeds and the failed check is swallowed. That committed a lint failure once tonight.

## Verify by mutation

The tube lab plan's two-stage review found a defect on all nine of its tasks, and the single
highest-yield instruction was "verify this by mutation". It held here too, and it is worth keeping:

- Two of my own tests passed with the code under test **deleted**. A closed-path seam test needed a
  superellipse sampled finely enough that corners span several vertices before it could bite; a
  square with single-vertex corners never straddles the seam at all.
- A `report.ts` predicate comparing bend radius against the *tube radius* instead of `ρmin` returns
  plausible booleans rather than failing, on the very panel used to judge whether the model worked.
  There is now a test whose fixture sits between the two so it discriminates.
- The plan's own mutation instruction for the wander cap had the direction backwards: `budget` is in
  the denominator, so raising it *tightens* the cap. Corrected in the plan.

## The baselines: two images, not four

**`look-piping` and `offaxis-piping` do not move.** The suite has been run against the current
branch and both pass. Piping's baseline is solid extruded letters with no cord visible anywhere — it
traces inset at `level: -0.015`, so the cord sits inside the letter body in both framings. **The
visual suite is blind to piping's cord**, which means it cannot see the change that matters most for
that look; piping's acceptance has to be `spikes/bend-acceptance.mjs` or a lab capture.

`look-tubing` and `offaxis-tubing` move, by 4047 pixels: corners visibly rounder, and nothing else.
**Do not pass `--update-snapshots`** — it rewrites all fifteen. Run the suite, expect exactly two
failures, and let `test-results/` be the evidence. A third moved image means the change leaked.

One effect reads as a regression if unnamed: every corner is rounded, cut back by up to 0.112 em.
Short-run wander no longer flattens — lobe count is now chosen by what the run carries, so that
prediction is off the list. The re-record is the owner's call.
