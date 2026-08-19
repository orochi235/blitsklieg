# Handoff — neon tubing, 2026-08-18

**For:** the next session picking this up. **Answers:** where the work sits, and what the next
decision is.

## State

The decoration layer is **done and merged** — PR #1, squashed onto `main` at `43729c6`, shipping
`@blitsklieg/core` 0.4.0: `tubing`, `piping`, `sequin`, `pyrite`, and per-letter materials. What it
does and why is in the spec and the CHANGELOG; do not re-read it from here. It was reviewed as one
diff and two findings were fixed before the merge; the rest are below.

Work in the shared checkout at `/Users/mike/src/blitsklieg`. The `core-v0` worktree carried the
decoration branch and is retired — nothing is left there.

Green on `main`: `npm run check` (400 tests), `npm run test:visual` (22 baselines).

- Spec: `docs/superpowers/specs/2026-08-18-decoration-layer-design.md`
- Plan: `docs/superpowers/plans/2026-08-18-decoration-layer.md` (all 12 tasks done)

## Next

**Neon tubing wants its own spec, and it is the interesting work.** `tubing` currently traces the
glyph outline, which reads as stroked line-art rather than a fabricated sign. The design doc's
Deferred section carries the whole argument — read it there. Two things that only exist in
conversation and are worth not losing:

- The levers wanted are **which edges get piped, how continuous each run is, and how many colors**.
  Those are selection and splitting over whatever paths the generator produces, and they are
  independent of how the paths are computed.
- Tube resolution is currently **accidental**, and the respec should not carry it forward.
  `CONTOUR_SEGMENTS = 48` reaches `Shape.getPoints()`, which in three means divisions *per curve*,
  with straight lines fixed at 1 — so `S` yields 1253 contour points and `L` yields 7. Straight-sided
  glyphs round into blobs, curved ones over-tessellate ~175×. Resample to fixed arc-length spacing.
- The path computation should be a **signed distance field over the flattened silhouette**, not
  polygon offsetting. One field yields every path shape involved, and a level set cannot
  self-intersect.
- Tubing needs an **off-axis debug view** — head-on hides the tube's cross-section, and idle yaw is
  only ~0.1 rad. Wanted eventually: a contact sheet of several viewpoints around the word, not one
  fixed angle. Build it by rotating the model between captures rather than by placing N cameras:
  `viewportBudget()` treats `camera.position.z` as the distance to the word plane, so any off-axis
  camera drifts the fit until that is reworked, while `word.group` takes a yaw directly. Deferred.

**`sequin` and `piping` are landed untuned, by decision.** Both have starting values, not chosen
ones. `sequin`'s flakes still go near-black (metalness 1 at roughness 0.08 facing away from the key
light); `piping`'s cord is largely occluded front-on at radius 0.03. Every decoration parameter has a lab slider — `npm run dev -w @blitsklieg/lab`, then
re-record baselines. No code change needed.

## Open review findings

The whole-branch review landed seven. Two were fixed before the merge. The rest are open, all low:

- ~30% of the chunk sample pool sits on the back cap, so `sequin` builds ~1.4× the instances it
  shows front-on (`decoration.ts:227`).
- `decorMaterial` never gets the per-letter flake seed that body materials get, so a decoration
  `flake` spec would sparkle in lockstep. Latent — no built-in look hits it (`word.ts:127`).
- `insetContour` discards the **whole contour** when a single vertex's bisector degenerates, and the
  result is indistinguishable from the deliberate too-thin rejection (`decoration.ts:74`).
- The lab's bloom checkbox is one-way for `neon` and `tubing`: unchecking it no longer removes
  bloom, and nothing in the UI says so (`apps/lab/src/main.ts:228`).

## Traps

**A bloomed look at DPR 2 can exhaust Playwright's default 5s screenshot budget** while the
stability loop waits for two consecutive frames. That is what it looks like when `tubing` fails to
baseline; it is not instability, and eight back-to-back captures hash identically. `shoot()` now
passes `timeout: 20000`.

**`maxDiffPixelRatio: 0.15` is too loose to catch a real render change**, so a green visual run is
not evidence that nothing moved. It is set that wide because the environment map is generated at
runtime. Bloom turning on did not fail the `neon` baseline, and neither did roughly doubling the
visible sequins; both had to be forced with `--update-snapshots=all`. That flag rewrites **every**
baseline, including looks the change cannot touch — re-record, then revert the ones that only moved
by environment-map noise.

**Never add `opacity` to `LookKey`.** There is a comment at the declaration saying so. `Word`
rewrites `material.opacity` every frame, so a value applied through `PARAM_KEYS` is gone by the
first tick — and it would pass any test that never calls `apply()`.
