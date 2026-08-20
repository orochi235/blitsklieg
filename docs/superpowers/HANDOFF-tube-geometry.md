# Handoff — tube geometry, 2026-08-20

**For:** the next session picking up the tube geometry work. **Answers:** what landed overnight,
what is left, and the two defects standing between here and acceptance.

Read `docs/superpowers/specs/2026-08-19-tube-geometry-design.md` for the model and
`docs/superpowers/plans/2026-08-20-tube-geometry.md` for the steps. This file is a pointer to those
plus what they cannot carry.

## Where the work is

Branch `tube-geometry`, unpushed, in the worktree `.claude/worktrees/tube-geometry`. Based on
`tube-lab` at `6bb0994` — the tube lab is finished and was built by a second session in the main
checkout; both branches are clean and disjoint.

`npm run check` green at **636 tests**. `npm run test:visual` has **not** been run and should not be
until the two defects below are fixed: the four baselines it would move are not yet moving for the
right reasons.

**Tasks 1–7 of the nine are committed. Task 7 does not meet its acceptance criterion** — that is the
main thing to know, and it is deliberate rather than overlooked.

| | |
| --- | --- |
| 1 | `bend` as a per-look material property, floored at 1.25 |
| 2 | corners classified by bend radius, not turn angle |
| 3 | `filletAt` — a tangent arc at `ρmin` |
| 4 | `ClearanceGrid` — the spatial hash |
| 5 | wander capped so it cannot out-bend the tube |
| 6 | **the invariant**: `sweepRun` holds the requested radius; `sweepRadius` → `tightestBend` |
| 7 | fillets wired into the cut — machinery lands, acceptance does not |
| 8 | the pigtail — **not started** |
| 9 | acceptance and the four baselines — **blocked on 7 and 8** |

## The two defects between here and acceptance

`node spikes/why-under-bend.mjs` reports both. It re-cuts `MWNSRE` under each pure corner strategy so
the two cannot be confused for each other:

```
all break    under-bend  1/61
all connect  under-bend 33/42
all loop     under-bend 30/42
```

**Breaking works.** Filleting and looping do not, and they fail for unrelated reasons.

### 1. A tight region is a stretch, not a vertex

This is a gap in the spec's model, not a bug in the code implementing it. The spec assumes a corner
is one vertex. On an SDF-extracted contour it is 2–4 vertices wide, because the field's blur rounds
every corner into a short arc. `cornersByBend` collapses each stretch to its tightest vertex — right
for deciding *that* there is a corner, wrong for fixing it — so `M` carries **21 vertices under
`ρmin` behind only 13 detected corners**, and filleting the tightest of each leaves the neighbours
over-bent.

The fix is to fillet the **whole group**, tangent to the legs *outside* it, rather than the single
vertex. Concretely: `cornersByBend` returns each corner's group extent (`from`/`to`); `filletFor`
takes its incoming direction at `from - 1 → from` and its outgoing at `to → to + 1`; the virtual
corner is the intersection of those two leg lines (closest point between them, since this is 3D), and
the setback runs from there. `S` is the case to watch — its widest stretch is 4 vertices.

**Answer this before building it: does the corner need to be a stretch at all?**

A corner is 2–4 vertices wide *because* the path is rasterised into a 256² distance field and
re-extracted. On the font's own béziers a corner is one vertex, and the analytic fillet the model
already specifies works without any of this. Three separate pieces of complexity trace to that one
root:

- group filleting against a virtual corner, above;
- `tightestBend`'s three smoothing passes, which are calibrated for the field's staircase noise and
  which shrink a coarsely-sampled arc's radius by a tenth — see the traps below;
- the blur masking the clamp, which is the argument the spec's `## Path fidelity` section uses to
  order this work *before* path fidelity.

That third one **expires with this change**: it says the blur hides the clamp, and the clamp is being
deleted. So the ordering argument should be re-derived rather than inherited, and the machinery above
may exist only to undo an artifact that was already scheduled for removal.

The counterweight is real: `piping` traces at `level: -0.015`, so it genuinely needs offset contours
and the field cannot simply be deleted. But "one look needs an offset" is a much narrower problem
than "the whole pipeline goes through a 256² grid".

**Re-run `spikes/clamp-vs-blur.mjs` before deciding.** Its numbers were taken under the old clamp,
which no longer exists, so the measurement that ordered this work may not still hold. This is a
sequencing call for the owner, not something to settle in code.

### 2. Loops are still the old `buildLoop`

Task 8 is untouched, so a loop still splices a full turn that lands exactly back on its corner. The
cusp at that join is what `all loop 30/42` is measuring. Nothing in tasks 1–7 changed it.

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

## The baselines, when you get there

Four images move: `look-tubing`, `look-piping`, `offaxis-tubing`, `offaxis-piping`. **Do not pass
`--update-snapshots`** — it rewrites all fifteen. Run the suite, expect exactly four failures, and
let Playwright's `test-results/` artifacts be the evidence. A fifth moved image means the change
leaked; stop rather than reasoning around it.

Three effects will be visible, and the last two read as regressions if unnamed:

1. `piping`'s cord roughly doubles — it drew at 26–69% of its requested 0.03 on every letter.
2. Every corner is rounded, cut back by up to 0.112 em.
3. Short runs' wander flattens: the Task 5 cap binds at `tubing`'s shipped `amplitude: 0.02` for any
   run near its `minRun: 0.15`, so amplitude is a request rather than a guarantee there.

The re-record is the owner's call. The recipe is in the spec's `## Baselines`.
