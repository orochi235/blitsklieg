# Handoff — neon tubing, 2026-08-18

**For:** the next session picking this up. **Answers:** where the work sits, and what the next
decision is.

## State

The decoration layer is **done and merged** — PR #1, squashed onto `main` at `43729c6`, shipping
`@blitsklieg/core` 0.4.0: `tubing`, `piping`, `sequin`, `pyrite`, and per-letter materials.

Neon tubing is **specced and planned, not implemented.** Branch `neon-tubing`, nothing built yet.

- Spec: `docs/superpowers/specs/2026-08-18-neon-tubing-design.md`
- Plan: `docs/superpowers/plans/2026-08-18-neon-tubing.md` — 12 tasks, TDD, none started
- Spike: `spikes/tube-paths.mjs` — the distance field, resampling and curvature already work
  here and the plan ports them rather than reinventing

Green on `main` and on this branch: `npm run check` (400 tests), `npm run test:visual`
(22 baselines).

## Next

**Execute the tubing plan.** It replaces the outline trace with runs cut from isocontours of a
signed distance field, across the glyph's three surfaces. The spec carries the argument; do not
re-derive it from here.

**Then: text runs, for an acrostic.** The target to build toward is a poem where the first letter
of each line carries its own color, then everything except those letters exits on command and the
first letters travel to the center of the screen and combine into a word. That needs two things
that do not exist:

- **Styled text runs** — spans of text carrying their own tint or look. `fire()` takes one `tint`
  for the whole word today. Per-letter materials removed the renderer obstacle in 0.4.0, so what
  is left is the caller-facing API, which is a text design question rather than a looks one.
- **Addressed exits and a gather** — an exit that applies to some letters and not others, and a
  motion piece that moves the survivors to a shared destination and closes the gaps. Today an exit
  is one slot applied to the whole word.

Both want a spec before code.

## Queued behind tubing

**`pyrite` needs roughly 20-30x its crystal count, or it goes.** At `count: 55` it reads as a few
gold flecks rather than intergrown crystal, and the owner's call is that if it stays that sparse it
is not worth shipping. Killing it is a breaking change — it is in the published `LookName` union
since 0.4.0 — so try the fix first.

Four things block a higher count, and the first three also cap `sequin`:

- `POOL = 512` in `decoration.ts` is a hard ceiling on distinct positions. Past it `chunkMatrices`
  exhausts its probe loop and reuses an index, so extra chunks stack co-located instead of covering
  new surface.
- ~30% of that pool sits on the back cap, so only about 360 samples are ever front-facing.
- The clustering draw scans the whole pool per chunk, so raising the pool makes placement quadratic.
- The lab's `chunk count` slider stops at 300, below even the current ceiling.

Crystal size wants to come down as count goes up, or the glyph just armours over.

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
