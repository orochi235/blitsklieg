# Handoff — tube geometry, 2026-08-20

**For:** the next session picking up the tube geometry work. **Answers:** what landed, what is
left, and what a reader would not guess from the plan.

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
`tube-lab` at `6bb0994`.

`npm run check` green at 637 tests; `npx playwright test` green at 24, with `look-tubing` and
`offaxis-tubing` re-recorded. **All nine tasks are closed.** Task 8 closed by removing the loop
rather than building the pigtail — see the spec — and task 9's results are in the spec's
`## Acceptance, as measured`.

Three changes landed beyond the plan, and the last two are the ones a reader will not expect:

- **Run ends are sealed.** The sweep emitted its wall and no cap, so every run ended in an open hole.
- **A corner can carry the tube past the light instead of cutting it.** `blockout` weights a return —
  the same fillet a connect draws, with the corner stretch marked unlit — against a real cut. A
  working neon unit has no free ends, and a bender paints the return rather than ending the glass.
- **Wander runs before the cut.** Its curvature cap is gone: a bend wander makes is a bend the corner
  stage sees and handles. That alone took tubing from 109 of 204 runs under `ρmin` to 5.

## Where the bend invariant stands

`node spikes/bend-acceptance.mjs` — whole pipeline, all 26 letters, both looks:

```
tubing              2/231 runs under rho_min   worst 1.94r
tubing no wander    1/207                      worst 1.91r
piping              3/47                       worst 1.43r
```

Five runs of 278. All but `piping`'s `S` are within 5% of the invariant. Chasing them is optional
work, not a blocker.

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

**Done, and re-recorded.** `look-piping` and `offaxis-piping` do not move: piping traces inset at
`level: -0.015`, so its cord sits inside the letter body in both framings and **the visual suite is
blind to the change that matters most for that look**. Piping's acceptance is the spike, not an
image.

If you re-record again: run the suite first and expect exactly the two tubing images to fail, then
`--update-snapshots=all --grep tubing`. Passing `--update-snapshots` without a grep rewrites all
fifteen.
