# Handoff — neon tubing, 2026-08-18

**For:** the next session picking this up. **Answers:** where the work sits, and what the next
decision is.

## State

The decoration layer merged as 0.4.0 (PR #1, `43729c6`). Neon tubing is **built and unmerged** on
branch `neon-tubing`: 470 tests green, `npm run check` clean.

The pipeline is complete and working — `packages/core/src/render/tube/` holds `field.ts` (signed
distance field, marching-squares isocontours), `resample.ts`, `surfaces.ts`, `generators.ts`,
`runs.ts`, `assign.ts`, `sweep.ts`, `wander.ts`, `index.ts`. `tubing` and `piping` both build from
it; `insetContour` and `CONTOUR_SEGMENTS` are gone.

Also landed, beyond the original plan: a rigid `transform` surface on `Word` and `FireOptions`
(column-major matrix as plain numbers, with `fromEuler`/`fromAxisAngle`/`compose` helpers in
`packages/core/src/transform.ts`), applied to an inner group so it composes with the viewport fit;
depth-varying face runs via `TubeSpec.amplitude`; `TubeSpec.cornerAngle`; the lab's filler text
removed and yaw/pitch/roll sliders added.

- Spec: `docs/superpowers/specs/2026-08-18-neon-tubing-design.md`
- Plan: `docs/superpowers/plans/2026-08-18-neon-tubing.md` — tasks 1-9 done, 10 partial, 11 not started

## Next, after tubing lands

**Text runs, for an acrostic.** A poem with each line's first letter in its own colour; the viewer
clicks, everything else exits, and the first letters gather into a word.

The spec at `docs/superpowers/specs/2026-08-19-text-runs-design.md` is settled with the owner. The
shape it landed on is **regrouping**: survivors leave their old group and become a new group whose
layout is the existing layout code re-run over their own glyphs. That makes the readable-word
version no more expensive than a cheap collapse, and it rules out the natural first move — a
`gather` motion piece cannot see the other survivors or change what the layout says.

Stages are data on `FireOptions` (`then: Stage[]`), advanced by the viewer's click, which
`hold: 'click'` already supports. Colour is a `tint` function cascading into span tint. Spans are
deliberately second, immediately after.

Work splits in two: regroup + stages + tween timing, then spans. Both off a fresh branch from
`main`.

## Not done on this branch

- **The visual suite guards the lab's page, not the type.** `shoot()` in
  `apps/lab/test/looks.spec.ts` screenshots the whole page rather than the canvas, so any control-
  panel edit invalidates every look baseline at once — the panel split and the removed filler text
  put 11 of them over tolerance while the word itself barely moved. Point it at the canvas locator
  and re-record all 15 once; then `maxDiffPixelRatio` can come down from 0.15 and start catching
  render changes. Merged as-is by decision, with only `tubing` and `piping` re-recorded.
- **`visual.spec.ts:162` cannot click `#wrap`** — the tube panel's heading overlaps the checkbox
  since the control-panel split. That is the lab layout pass, now with a test failing over it.
- **The visual baseline has never been re-recorded.** `look-tubing-darwin.png` and
  `look-piping-darwin.png` still show the pre-rewrite look. The sweep is fixed now (see below), so
  re-recording is unblocked — but do it after the thin-radius occlusion finding below is settled,
  or the baseline locks in whatever radius dodges it today.
- **Lab diagnostics**, all requested and none built: a depth colour ramp, a per-run arc-length
  colour ramp (both should share one mechanism — a per-vertex scalar through one ramp, with a
  switchable source), and white letterform outlines drawn from `surfacesOf()`'s contour rings at
  both the front and back planes.
- **Lab parameter sliders** for `level`, `runs`, `minRun`, lit fraction, wall depth, wall rise and
  a surfaces picker. The old `tubeAt` and `inset` sliders are still in the DOM as dead controls.
- **A limb-brightening rim** on the tube material. Flat emissive renders a cylinder as a ribbon.
  This is the last unbuilt look item and the owner rated it a bonus, not the point.

## Corner strategies are in

`break`, `connect` and `loop`, drawn per corner from a seeded weight distribution, biased by the
corner's turn angle and the room around it. `cornerAngle` is gone — `piping` now sets
`corners: ALL_CONNECT`, which says what it means. `tubing` ships a placeholder mix of
55/30/15, tunable from three lab sliders.

Loop radius is 4x the tube radius, clear of the 1.25x floor the curvature taper needs to keep full
width through the turn.

**All-loop is a stress test, not a setting.** Every corner getting a flourish buries a word, and on
`E`, whose corners are close together, the loops overlap until the letter is barely legible. The
mixed distribution is the point.

## Standing conventions for this work

Test string is `NSR` — straight, curved, and mixed-with-counter. `E` spot-checks corner behavior.
Captures at yaw 30 / pitch 13 degrees so they stay comparable. Judge by looking at the image, not
by a green test run: the geometry has been correct while the render was visibly torn.

## Fixed: three's tube sweep breaking on curved 3D paths

`sweep.ts` no longer calls `THREE.TubeGeometry`. It builds the tube's `BufferGeometry` itself from
a rotation-minimizing frame per point (`frames.ts`, double-reflection method, Wang/Jüttler/Zheng/Liu
2008), which stays stable through inflections and low curvature instead of flipping there. The
`CatmullRomCurve3` re-resample is gone too — the run's points are already arc-length spaced and
corner-cut, so sweeping them directly is both simpler and one less parameterization to reason about.

`sweepRadius`'s curvature taper is now 3D (`minCurvatureRadius3` in `resample.ts`), so it sees a
face run's depth wander instead of only its flattened x/y projection.

`radius` came down from 0.045 to 0.04 and `amplitude` went up from 0.006 to 0.02 in `looks.ts`.
Verified with a synthetic S-curve test (`frames.test.ts`): the old Frenet frame's worst
consecutive-normal dot product goes negative (a flip past 90°) at high depth amplitude on this
font's actual `S` glyph, where the new RMF frame stays above 0.5 on the same run.

`radius` is now 0.022 and `amplitude` 0.02 in `looks.ts`. Verified with a synthetic S-curve test
(`frames.test.ts`): the old Frenet frame's worst consecutive-normal dot product goes negative — a
flip past 90 degrees — at high depth amplitude on this font's actual `S`, where the RMF frame stays
above 0.5 on the same run.

## Fixed: a transparent backing was depth-culling its own tube

This one is worth reading, because it was misdiagnosed twice and the misdiagnosis cost real work.

Thinning `tubing.radius` used to make most of the sign vanish. That was attributed first to Frenet
instability and then to the tube being occluded by the glyph's own extrusion wall. Neither. A
`transparent` material still writes depth by default, and tubing's backing sits at `opacity: 0.08`
— 92% see-through, and writing depth the whole time. It was culling the tube drawn behind it.
Thinning the radius put more of the tube inside the silhouette, so more of it disappeared, which
read convincingly as a sweep bug getting worse.

The fix is one line in `word.ts`: do not write depth when the body is not opaque. The tube then
renders correctly at 0.022, and the unlit dark-glass runs became visible for the first time — they
had been hidden by the same mechanism.

This is also the "piping's cord is largely occluded front-on at radius 0.03" note from 0.4.0,
recorded then as something to tune rather than as a defect.

**The lesson worth keeping:** a cheap hypothesis about render state should be eliminated before an
expensive one about geometry. "The transparent thing in front is hiding it" costs one line to test;
"the frame algorithm is unstable" cost two agents' budget. The RMF work was still correct and worth
keeping — Frenet genuinely does tear at higher amplitude — but it was dispatched as a fix for a
blocker that was somewhere else entirely.

## Defect to fix: the lab reaches past the public surface

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

## The lab panel needs a layout pass

It has grown into a single tall column of controls covering roughly a third of the canvas, so every
screenshot loses part of the word and there is nowhere to put the diagnostics still to come. Split
it into groups and use the available width.

## Queued behind tubing

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

From the 0.4.0 whole-branch review. Two were fixed before the merge; these are the rest, all low:

- ~30% of the chunk sample pool sits on the back cap, so `sequin` builds ~1.4× the instances it
  shows front-on (`decoration.ts:227`).
- `decorMaterial` never gets the per-letter flake seed that body materials get, so a decoration
  `flake` spec would sparkle in lockstep. Latent — no built-in look hits it (`word.ts:127`).
- The lab's bloom checkbox is one-way for `neon` and `tubing`: unchecking it no longer removes
  bloom, and nothing in the UI says so (`apps/lab/src/main.ts:228`).

`insetContour`'s all-or-nothing contour rejection was the fourth. The tubing plan deletes that
function, so it closes with the rewrite.

**`sequin` and `piping` are landed untuned, by decision.** `sequin`'s flakes still go near-black
(metalness 1 at roughness 0.08 facing away from the key light); `piping`'s cord is largely
occluded front-on at radius 0.03. Every decoration parameter has a lab slider —
`npm run dev -w @blitsklieg/lab`, then re-record baselines. No code change needed.

## Traps

**A bloomed look at DPR 2 can exhaust Playwright's default 5s screenshot budget** while the
stability loop waits for two consecutive frames. That is what it looks like when `tubing` fails to
baseline; it is not instability, and eight back-to-back captures hash identically. `shoot()` now
passes `timeout: 20000`.

**`maxDiffPixelRatio: 0.15` is too loose to catch a real render change**, so a green visual run is
not evidence that nothing moved. It is set that wide because the environment map is generated at
runtime. Bloom turning on did not fail the `neon` baseline, and neither did roughly doubling the
visible sequins; both had to be forced with `--update-snapshots=all`. That flag rewrites **every**
baseline, including looks the change cannot touch — re-record, then revert the ones that only
moved by environment-map noise.

**Never add `opacity` to `LookKey`.** There is a comment at the declaration saying so. `Word`
rewrites `material.opacity` every frame, so a value applied through `PARAM_KEYS` is gone by the
first tick — and it would pass any test that never calls `apply()`.

**Tubing needs an off-axis debug view before its geometry can be judged.** A run varying in depth
is invisible head-on and idle yaw is only ~0.1 rad, so the visual baseline cannot see most of what
the respec adds. Build it by yawing `word.group` between captures rather than by moving the
camera: `viewportBudget()` treats `camera.position.z` as the distance to the word plane, so an
off-axis camera drifts the fit until that is reworked. Deferred, and called out in the spec.
