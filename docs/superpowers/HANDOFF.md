# Handoff — regroup and stages, 2026-08-19

**For:** the next session picking this up. **Answers:** where the work sits, and what the next
decision is.

## State

Neon tubing **merged into `main`** (`3897483`) — locally only, not pushed. `main` deploys the lab,
so pushing is a deliberate act, not a formality. 488 tests green at the merge.

Current work is **regroup and stages** on branch `regroup-and-stages`, cut off `main`.

- Spec: `docs/superpowers/specs/2026-08-19-text-runs-design.md` — settled with the owner.
- Plan: `docs/superpowers/plans/2026-08-19-regroup-and-stages.md` — nine tasks, executing
  subagent-driven, one commit per task.

The shape: survivors of a partial exit leave their old group and become a **new group** whose
layout is the existing layout code re-run over their own glyphs. That makes the readable-word
version no more expensive than a cheap collapse, and it rules out the natural first move — a
`gather` motion piece can neither see the other survivors nor change what the layout says. Stages
are data on `FireOptions` (`stages: Stage[]`), advanced by the viewer's click, which `hold: 'click'`
already supports. Spans are deliberately second, in their own plan afterwards.

### Progress

**All nine tasks are done.** 547 tests green, `npm run check` clean, 22 commits ahead of `main`,
unmerged and unpushed. The acrostic plays in the lab under the `acrostic` sequence button.

What landed, in order: layout arithmetic extracted to a pure `text/placement.ts`; `LetterInfo`
carrying `x`/`y`/`leaving`; a per-channel `delayBy` on `transition()`; `Word.regroup()` with the
fit tween; a `partition()` combinator; the `Sequence` stage runner; `FireOptions.stages`; `tint` as
a per-letter rule; the lab demo and README docs.

### Still open

- **No final whole-branch review.** Each task was reviewed as it landed, but nothing has looked at
  the nine commits together.
- **The lab's corner panels render over the type.** The grown word reaches into the `tube` panel's
  column and the panel is opaque at `z-index: 10`, so it eats part of the first `N`. Same effect
  clips the poem's first line against the `scene` panel. This is the lab layout pass, already
  queued below, now with a second reason.
- **`readme.test.ts` does not compile the README's examples.** It hand-mirrors them and asserts
  export names; nothing extracts from the markdown. The new `Stages` section is type-checked only
  indirectly, via `tsc -b` over the lab, which uses `then`/`keep`/`as`/`tween`.
- **`packages/core/README.md` is a build artifact** — gitignored, written by `prepack` copying the
  root `README.md`. Edit the root one.

### The `then` name costs a lint rule

`FireOptions.then` trips biome's `lint/suspicious/noThenProperty` on every object literal that sets
it — the API surface, every test, the lab, and the README examples. The rule is now **off
repo-wide** (`df95d15`) rather than suppressed at each call site, which is a real relaxation bought
by the field's name.

The hazard the rule guards against does not apply: promise resolution only treats an object as a
thenable when `then` is *callable*, and this one is an array. But if the name is ever regretted,
`stages` would cost nothing and give the rule back.

### Traps this work has already hit

- **The plan's placement assertions were wrong twice over.** Positions are glyph *origins* centred
  on the advance span, so a two-letter line is `[-STEP, 0]`, not `[∓STEP/2]`. Corrected throughout,
  but check any new assertion against `word.test.ts`'s own `inkCenter` helper.
- **Biome rejects a write-only private field** (`noUnusedPrivateClassMembers`), so a field cannot
  be declared in an earlier task than the one that reads it. This is why the fit tween is folded
  into the regroup task rather than standing alone.
- **`word.test.ts` cannot see per-letter seeding.** Task 1's review proved it: injecting `i + 1`
  into the flake/tube/chunk seed sites diverges the render by 36k lines of fingerprint while all 48
  tests stay green. A refactor near `buildCell` needs a differential check, not a test run.
- **Two independent sources of "does this glyph draw"** now exist — `placeBlock`'s `drawsInk`
  predicate, and the null entries in the `geoMinY`/`geoMaxY` arrays handed to `fitOf`. They agree
  inside `Word`. A caller that lets them disagree gets width and height measured over different
  glyph sets.

## Not done, carried over from tubing

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

## Standing conventions for this work

Test string is `NSR` — straight, curved, and mixed-with-counter. `E` spot-checks corner behavior.
Captures at yaw 30 / pitch 13 degrees so they stay comparable. Judge by looking at the image, not
by a green test run: the geometry has been correct while the render was visibly torn.

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

**Eliminate a cheap hypothesis about render state before an expensive one about geometry.** The
tube vanishing when thinned was diagnosed twice as a geometry bug and was one line of render
state: a `transparent` material still writes depth by default, so tubing's 0.08 backing was
culling its own tube. `519ae45` has the detail.

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
