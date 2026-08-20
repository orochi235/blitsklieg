# Handoff — tube lab, 2026-08-19

**For:** the next session picking this up. **Answers:** where the tube lab work sits, and what is
next.

## State

Branch `tube-lab`, unpushed. The plan is
`docs/superpowers/plans/2026-08-19-tube-lab.md` and its steps are checkboxed as they land — **tasks
1 through 5 are done**, 6 through 10 remain. The spec it implements is
`docs/superpowers/specs/2026-08-19-tube-lab-design.md`; read that rather than this file for what the
lab is.

`npm run check` is green at 594 tests; `npm run test:visual` at 24. The lab runs with
`npm run dev:tube-lab -w blitsklieg` and currently draws sixteen letters of `tubing`, one per panel,
on one WebGL context. Every mode renders the same beauty view — `skeleton`, `ramp` and `orbit` are
tasks 6, 7 and 8.

**Execution is subagent-driven** (`superpowers:subagent-driven-development`): one implementer per
task, then a spec-compliance review, then a code-quality review, fixing between. That loop has
found a defect in the plan on **every** task so far, so keep it rather than trusting the plan text.
The single highest-yield instruction has been "verify this by mutation" — it has found a hole in
every task's tests, including ones already tightened once.

## Blocked on windease, worked around

`splitStrategy` in windease 0.8 cannot tile: `initialState` builds a right-leaning spine, and at
sixteen panels nine land at zero-or-negative width and seven outside the container. It also silently
drops a panel its tree does not know about — no error, no `unplaced` entry.

The lab therefore owns its own `SplitNode` in `packages/core/dev/tube-lab/src/tree.ts` (build, graft
a leaf, collapse a leaf) and seeds it via `setContainerState`. That is **throwaway by design**:
windease has recorded a decision to delete `SplitNode` and replace `splitStrategy` with a
`split(zoneId, …)` store operation, at which point `tree.ts` goes and the lab uses the verb. The
consumer report is in windease's own `TODO.md` under "Replace `splitStrategy` with a split
*operation*". Panel drag-to-rearrange is deferred until that lands; gutter resize works.

## Traps this work has hit

- **A rAF guard that returns early drops the newest state.** `if (frame) return` discards the later
  call while the queued closure holds the older one, so the canvas stays permanently wrong. Keep the
  newest body in a ref and have the frame call that.
- **Gutter strips lie outside every panel's scissor**, so under `preserveDrawingBuffer` nothing
  wipes them and a re-tile leaves slivers of the old frame. A full-canvas clear per redraw, kept out
  of the per-panel `draw()`.
- **A scissor survives into three's multisample resolve.** `blitFramebuffer` is scissor-clipped, so
  scissoring a scene pass into an MSAA target strands the previous panel in the margins for the blur
  to read back. Viewport-only there.
- **`fitScale` caps enlargement at 2.2x**, so one glyph fills ~30% of a panel; the lab scales its own
  pivot, and that scale has to solve at the **tube's** front plane, not the word's, or it overshoots
  ~35% through perspective.
- **A reload does not unmount**, so a debounced save needs a `pagehide` flush or a drag made inside
  the window is lost.

### What just landed

The lab's four corner panels are gone, replaced by two full-width docks. The word occupies the
middle 62% of the width but only 30% of the height, so the bands above and below it are the
largest region controls can hold without ever sitting under the type; the corners could not be
made to work at 800x600, where the top and bottom panel in a column overlapped by 32px because
`max-height` was being applied content-box. Four groups per dock, controls that shrink instead of
overflowing their column.

Also closed, all with `npm run check` and the 24 Playwright specs green:

- **`visual.spec.ts` could not click `#wrap`** — it sat under the overlapping tube panel. Fixed by
  the dock layout; the spec passes untouched.
- **The bloom checkbox was one-way.** It is now a three-way `auto`/`on`/`off` select: unchecked
  could only ever mean "unset", because `FireOptions.bloom` wins over a look's own request, so
  there was no way to switch neon's bloom off. `auto` and `on` render identically for neon; `off`
  is a different image.
- **A restored hash is now announced.** A saved `enter: none` / `active: none` survives reload and
  reads as a lab that stopped animating, and only editing the address bar cleared it. The session
  group now names what was restored and offers a reset.
- **`decorMaterial` never got the per-letter flake seed.** Every material a letter owns now takes
  it, body and decoration alike, via one `seedFlake` helper. Covered by a test proven to die when
  the call is removed.
- **The chunk count slider stopped at 300**, below the real `POOL = 512` ceiling. The probe loop in
  `chunkMatrices` places exactly `POOL` distinct chunks and stacks only past it, so 512 is the
  slider's correct maximum.

### The visual suite now guards the type, not the page

`shoot()` injects `main, .dock { display: none; }` before capturing, so a baseline is a function of
the look alone and no control-panel edit can invalidate one again. All 15 were re-recorded, which
also retires the stale pre-rewrite `tubing` and `piping` baselines.

**Pointing the capture at the canvas locator — the fix this doc used to propose — would not have
worked.** The canvas is transparent everywhere the letters do not draw, so an element screenshot
still composites the page and panels through it.

**The tolerance that mattered was `threshold`, not `maxDiffPixelRatio`.** Bloom is a wide,
low-amplitude halo: turning it off moves 8.3% of pixels but by a median of 8/255 and a maximum of
54/255, so at Playwright's default per-pixel `threshold: 0.2` nothing was counted and no ratio,
however tight, could have caught it. Now at `threshold: 0.02` / `maxDiffPixelRatio: 0.001`, which
fails on bloom-off at ratio 0.04 and passes on repeated clean runs.

### `piping` ships a decoration that barely renders

Front-on, `look-piping-darwin.png` was **byte-identical** to `look-leather-darwin.png` — the cord
contributed not one pixel, so that baseline guarded the body and nothing the decoration adds. A new
`off axis` describe yaws the word group 30 degrees, matching the standing convention below, and
records `tubing` and `piping` there. `tubing` shows its tube plainly; `piping` differs from a yawed
`leather` only slightly. Tuning it is the untuned-by-decision item under **Open review findings**.

The word group is yawed rather than the camera: `viewportBudget()` reads `camera.position.z` as the
distance to the word plane, so an off-axis camera drifts the fit instead.

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

**`sequin` and `piping` are landed untuned, by decision.** `sequin`'s flakes still go near-black
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
