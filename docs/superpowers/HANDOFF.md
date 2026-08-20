# Handoff — tube lab, 2026-08-19

**For:** the next session picking this up. **Answers:** where the tube lab work sits, and what is
next.

## State

**The tube lab is done — all ten tasks plus an 8b, every step ticked** in
`docs/superpowers/plans/2026-08-19-tube-lab.md`. Branch `tube-lab`, unpushed. `npm run check` green
at 609 tests; `npm run test:visual` at 24 with no baseline moved by any of it.

Run it with `npm run dev:tube-lab -w blitsklieg`. Sixteen panels on one WebGL context, one letter
each, three modes — `beauty`, `skeleton`, `ramp` — with pose orthogonal to mode: every panel drags
to turn, wheel-zooms 0.5x–4x, and has a hover-revealed reset. A rail tunes the whole `TubeSpec` at
once, including the `front`/`back`/`wall` checkboxes and `connectors` that let it trace an extruded
letter rather than a flat contour.

**Task 10 deleted `packages/core/src/debug.ts` and `apps/lab/src/diagnostics.ts`.** `apps/lab` now
imports only from `blitsklieg`, and the second render path that once shipped a real bug — materials
at three's default opacity because nothing called `apply()` — is gone. `WordDebugHooks` stays; it is
a genuine narrow surface and the tube lab uses it.

## What the lab found, and what happens next

It was built to make two geometry defects observable. It did, on day one, and the fix is specced:

- **`docs/superpowers/specs/2026-08-19-tube-geometry-design.md`** — replace the per-run radius clamp
  with a minimum-bend-radius model, and make loops real pigtails. All three of its open decisions are
  settled: `bend` defaults to 2, the pigtail winds in the depth plane, the clearance query ships in
  v1.
- A second session is executing that from `docs/superpowers/plans/2026-08-20-tube-geometry.md` on
  branch `tube-geometry`, in a worktree. It also owns a `pyrite` respec.
- `spikes/clamp-vs-blur.mjs` re-derives the finding that ordered the work: **sharpening the tube's
  path makes the clamp worse**, because the distance field's rasterisation blur rounds corners and
  the clamp measures curvature. The blur is masking the defect, so the clamp model has to land before
  path fidelity.

Two measurements worth not rediscovering:

- **`NSRE` hides the worst cases.** A 26-letter sweep ranks tightest bend as M 0.32r, W 0.38r,
  B 0.40r, V 0.40r, N 0.44r. The N is fifth. The lab's default letters are now `MWSB` for that
  reason; `piping`'s extremes are a different set (Q, X, Y) because it traces inset at `level:
  -0.015`.
- **`piping`'s cord is clamped, not untuned** — all 5 runs, at 44–87% of its requested 0.03.

## Known limitation

A spec change rebuilds all sixteen cells, ~1.45s front-only and ~2.85s with `back`/`wall`/
`connectors`. Sliders commit on release rather than per input, so a drag costs one rebuild instead of
twenty — but a single step still waits. The honest fix is not rebuilding a whole `Word` per cell for
a spec change; it was out of scope.

## windease: the workaround has an expiry date

`packages/core/dev/tube-lab/src/tree.ts` exists because `splitStrategy` in windease 0.8 cannot tile —
`initialState` builds a right-leaning spine, and at sixteen panels nine panes land at zero-or-negative
width. It also silently drops a panel its tree does not know about.

**Upstream has since replaced `splitStrategy` entirely**: `stripStrategy` plus a `store.split(id,
input)` verb, with resize writing to `membership.placement.size` rather than separate strategy state.
That fixes both bugs and the missing drag-to-rearrange. We are pinned at `windease@^0.8.0`, so
nothing breaks today, but upgrading deletes `tree.ts` and rewrites the seeding — do it deliberately.

## Not done, carried over from tubing

- **A limb-brightening rim** on the tube material. Flat emissive renders a cylinder as a ribbon.
  This is the last unbuilt look item and the owner rated it a bonus, not the point.

## Standing conventions for this work

Test string is `NSR` — straight, curved, and mixed-with-counter. `E` spot-checks corner behavior.
Captures at yaw 30 / pitch 13 degrees so they stay comparable. Judge by looking at the image, not
by a green test run: the geometry has been correct while the render was visibly torn.

## Defect being fixed: the lab reaches past the public surface

**Task 10 of the tube lab plan deletes both diagnostic paths.** The section below is the reasoning;
the plan carries the steps.

`packages/core/src/debug.ts` re-exports `Word`, `Stage`, `Timeline`, `NONE`, `loadFont` and
`surfacesOf`, and `apps/lab/src/diagnostics.ts` imports them through a deep relative path. The lab
is consumer code, so this is the reach-past-the-public-surface pattern this project does not allow,
even though `debug.ts` is absent from the package's `exports` and `files` and so cannot be reached
from the published npm package.

The concrete cost is not packaging, it is that **the lab now has two render paths**. Its diagnostic
mode hand-rolls a `fire()` — mount a `Stage`, construct a `Word`, apply a rest pose, render once —
bypassing the queue, the timeline and the bloom chain. It will drift from the real path, and it
already produced one bug that way: materials sat at three's default opacity of 1 because nothing
called `apply()`, so tubing's 0.08 backing rendered fully opaque.

The other half of the same change is fine and should be kept: `WordDebugHooks`, an optional seventh
constructor parameter on `Word` offering `tubeMaterial(which)` and `onLetter(cell, shapes, depth)`,
inert when omitted. That is a real narrow surface.

The fix is to route diagnostics through the public API so there is one render path — most likely a
debug field on `FireOptions` or `BlitskliegOptions` that carries the same hooks — and then delete
`debug.ts`. That is a public API shape decision, so it wants the owner's call rather than a
unilateral one.

## Queued

**`pyrite` is built on the wrong model and should be respecced before it is tuned.** The chunk
generator samples surface points and sticks a chunk on each — dip it in glue and roll it in
sprinkles. That is right for `glitter` and roughly right for `sequin`, which genuinely are applied
to a surface. Pyrite is *intergrown*: cubes grown out of the matrix, mostly buried, penetrating
each other, faces parallel within a grain because they share a lattice.

More crystals will not fix that. Three changes to the placement model would do more than raising
the count 30x:

- **Vary size.** Every chunk uses one `size`. Crystal beds are power-law — many small, a few large
  — and that scale variation is most of what makes a texture read as grown rather than applied.
- **Vary embedding.** `proud` is one value for every chunk, so all of them sit the same fraction
  out, which is precisely the glued look. Most should barely break the surface.
- **Allow interpenetration.** `chunkMatrices` draws sample points without replacement, so chunks
  can never overlap. Real cubes grow into each other; combined with the existing `align` toward a
  shared per-letter lattice, overlap is what turns scattered dice into one crystal mass.

If a respec still leaves it not worth shipping, killing it is the owner's call — but note that is a
breaking change, since `pyrite` has been in the published `LookName` union since 0.4.0.

Separately, and independent of the model question, two ceilings cap **both** chunk looks:
`POOL = 512` in `decoration.ts` bounds distinct positions (past it `chunkMatrices` exhausts its
probe loop and stacks chunks co-located), about 30% of that pool sits on the back cap, and the
clustering draw scans the whole pool per chunk so raising it makes placement quadratic. The lab's
`chunk count` slider also stops at 300, below even the current ceiling.

## Open review findings

From the 0.4.0 whole-branch review. The flake-seed and bloom-checkbox findings are now fixed; one
is left, and it wants a decision rather than a patch:

- **~30% of the chunk sample pool sits on the back cap**, so `sequin` builds ~1.4x the instances it
  shows front-on (`decoration.ts:227`). Rejecting back-facing samples would fix the waste, but it
  changes which pool indices exist and so **changes how both chunk looks render** — a visible
  change to looks published since 0.4.0, in the same code a `pyrite` respec would rewrite.

`insetContour`'s all-or-nothing contour rejection was the fourth. The tubing plan deletes that
function, so it closes with the rewrite.

**`piping`'s cord is not untuned — it is clamped.** Measured across `NSRE`, **every** piping run
hits the per-run radius clamp (5 of 5), drawing at 44–87% of its requested 0.03. `piping` connects
through its corners instead of breaking, so one run traverses the whole letter and the single
tightest corner anywhere in the glyph sets the diameter for the entire cord. No slider fixes that;
`docs/superpowers/specs/2026-08-19-tube-geometry-design.md` does. Reproduce with
`spikes/clamp-vs-blur.mjs`.

**`sequin` is landed untuned, by decision.** `sequin`'s flakes still go near-black
(metalness 1 at roughness 0.08 facing away from the key light); `piping`'s cord draws nothing at
all front-on at radius 0.03, and little enough at 30 degrees of yaw. Every decoration parameter has
a lab slider — `npm run dev -w @blitsklieg/lab`, then re-record baselines. No code change needed.

## Traps

**Eliminate a cheap hypothesis about render state before an expensive one about geometry.** The
tube vanishing when thinned was diagnosed twice as a geometry bug and was one line of render
state: a `transparent` material still writes depth by default, so tubing's 0.08 backing was
culling its own tube. `519ae45` has the detail.

**A bloomed look at DPR 2 can exhaust Playwright's default 5s screenshot budget** while the
stability loop waits for two consecutive frames. That is what it looks like when `tubing` fails to
baseline; it is not instability, and eight back-to-back captures hash identically. `shoot()` now
passes `timeout: 20000`.

**A per-pixel `threshold` is what decides whether a visual baseline can see a change at all**, and
the pixel-count ratio cannot substitute for it. Playwright's default 0.2 hid bloom entirely; see
the visual-suite section above for the measured numbers. `--update-snapshots=all` rewrites **every**
baseline, including looks the change cannot touch, so re-record deliberately.

**Never add `opacity` to `LookKey`.** There is a comment at the declaration saying so. `Word`
rewrites `material.opacity` every frame, so a value applied through `PARAM_KEYS` is gone by the
first tick — and it would pass any test that never calls `apply()`.

**Tubing needs an off-axis debug view before its geometry can be judged.** A run varying in depth
is invisible head-on and idle yaw is only ~0.1 rad, so the visual baseline cannot see most of what
the respec adds. Build it by yawing `word.group` between captures rather than by moving the
camera: `viewportBudget()` treats `camera.position.z` as the distance to the word plane, so an
off-axis camera drifts the fit until that is reworked. Deferred, and called out in the spec.
