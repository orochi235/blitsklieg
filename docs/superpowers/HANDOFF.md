# Handoff — decoration layer, 2026-08-18

**For:** the next session picking this up. **Answers:** where the work sits, and what the next
decision is.

## State

PR https://github.com/orochi235/blitsklieg/pull/1 — `decoration-layer` → `main`, 28 commits, open
and unreviewed. Branch is pushed and the tree is clean. `main` is at `9b3b673` (v0.3.1).

Worktree: `/Users/mike/src/blitsklieg/.claude/worktrees/core-v0`. The shared checkout at
`/Users/mike/src/blitsklieg` has `main` checked out — git operations from the worktree cannot
target it.

Green: `npm run check` (396 tests), `npm run test:visual` (22 baselines).

Ships `@blitsklieg/core` 0.4.0: `tubing`, `piping`, `sequin`, `pyrite`, and per-letter materials.
What it does and why is in the spec and the CHANGELOG; do not re-read it from here.

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
- The path computation should be a **signed distance field over the flattened silhouette**, not
  polygon offsetting. One field yields every path shape involved, and a level set cannot
  self-intersect.

**`sequin` and `piping` are landed untuned, by decision.** Both have starting values, not chosen
ones. `sequin`'s flakes go near-black (metalness 1 at roughness 0.08 facing away from the key
light) so 90 chunks read as far fewer; `piping`'s cord is largely occluded front-on at radius
0.03. Every decoration parameter has a lab slider — `npm run dev -w @blitsklieg/lab`, then
re-record baselines. No code change needed.

## Traps

**A bloomed look at DPR 2 can exhaust Playwright's default 5s screenshot budget** while the
stability loop waits for two consecutive frames. That is what it looks like when `tubing` fails to
baseline; it is not instability, and eight back-to-back captures hash identically. `shoot()` now
passes `timeout: 20000`.

**`maxDiffPixelRatio: 0.15` is too loose to catch bloom appearing or disappearing.** It is set
that wide because the environment map is generated at runtime. Bloom turning on did not fail the
`neon` baseline; the change had to be forced with `--update-snapshots=all`.

**Never add `opacity` to `LookKey`.** There is a comment at the declaration saying so. `Word`
rewrites `material.opacity` every frame, so a value applied through `PARAM_KEYS` is gone by the
first tick — and it would pass any test that never calls `apply()`.

**The final whole-branch review was never run.** Per-task reviews were, and they caught four
defects in the plan text itself, but nobody has read the 28 commits as one diff.
