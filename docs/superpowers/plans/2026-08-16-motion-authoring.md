# Motion Authoring Vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make motion pieces constructible from a declarative spec, rewrite the existing thirteen on top of it, and open `MotionPiece` as public API.

**Architecture:** A two-stop transition is `scaleOffset(from, 1 - ease(t))`, a primitive `pose.ts` already has. `transition()` and `cycle()` are constructors over it. A golden fixture captured from today's pieces makes the rewrite provably behavior-preserving.

**Tech Stack:** TypeScript 7, vitest 4, Biome 2.

**Reference:** `docs/superpowers/specs/2026-08-16-motion-authoring-design.md`

---

### Task 1: Capture the parity golden

Sample every existing piece before touching it. Without this the rewrite is unfalsifiable.

**Files:**
- Create: `packages/core/test/motion/golden.json`
- Create: `packages/core/test/motion/golden.test.ts`

- [ ] **Step 1: Write a test that regenerates and compares the golden**

Sample each of the 13 pieces at `t` in 0…1 by 0.05, for letter indices 0…4 of a 5-letter word,
rounding to 9 decimals. Fail if the sampled values differ from `golden.json`.

- [ ] **Step 2: Generate the file, run, commit**

The first run writes it; every later run compares. This test guards Tasks 4 and 5.

---

### Task 2: spring()

**Files:**
- Modify: `packages/core/src/easing.ts`
- Test: `packages/core/test/easing.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('starts at 0 and lands exactly on 1', () => {
  const s = spring();
  expect(s(0)).toBe(0);
  expect(s(1)).toBe(1);
});

it('overshoots past 1 when underdamped', () => {
  const s = spring({ stiffness: 180, damping: 8 });
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => s(i / 100)));
  expect(peak).toBeGreaterThan(1);
});

it('does not overshoot when critically damped', () => {
  const s = spring({ stiffness: 100, damping: 20, mass: 1 });
  for (let i = 0; i <= 100; i++) expect(s(i / 100)).toBeLessThanOrEqual(1.0000001);
});
```

- [ ] **Step 2: Implement**

Closed-form step response of a damped oscillator on normalized `t`, then the residual correction
`f(t) = raw(t) + t · (1 - raw(1))` so both endpoints are exact. Without it every letter settles
fractionally short of rest, permanently, because `enter` hands to `active` at exactly `t = 1`.

- [ ] **Step 3: Run, then commit**

---

### Task 3: Stagger order keys

**Files:**
- Modify: `packages/core/src/motion/types.ts`
- Test: `packages/core/test/motion/types.test.ts`

- [ ] **Step 1: Write the failing tests**

`orderKey(letter, from)` returns 0…1 per mode: `start` is `index / count` (today's behavior
exactly), `end` reversed, `center` distance from the middle, `edges` its complement, `random` a
deterministic hash. With `grid`, measure over `(column, line)` instead of reading order.

- [ ] **Step 2: Implement**

`stagger(t, letter, spec)` keeps its clamped ramp and takes `start = orderKey · spread`, with
`spread = each × count` when `each` is given. `random` must be a hash of the index, never a
seeded generator: screenshot tests compare frames across runs.

Keep the existing `stagger(t, letter, spread: number)` overload working — the repertoire and its
golden depend on it until Task 4.

- [ ] **Step 3: Run, then commit**

---

### Task 4: transition() and cycle()

**Files:**
- Create: `packages/core/src/motion/build.ts`
- Test: `packages/core/test/motion/build.test.ts`

- [ ] **Step 1: Write the failing tests**

- `from` relaxes toward identity, `to` departs from it.
- `{ scale: 0.5 }` reaches 1, never 0 — the `scaleOffset` semantics.
- Two-stop `keyframes` equal the `from`/`to` sugar to the number.
- `easeBy` overrides one channel while the rest keep `ease`.
- `cycle` harmonics and per-letter phase.

- [ ] **Step 2: Implement**

`transition` interpolates stops channel-wise with absent channels reading as identity;
`cycle` is `amplitude · sin(t · 2π · harmonic + phase)` with multiplicative channels centered
on 1.

- [ ] **Step 3: Run, then commit**

---

### Task 5: Rewrite the repertoire

**Files:**
- Modify: `packages/core/src/motion/enter.ts`, `exit.ts`, `active.ts`

- [ ] **Step 1: Rewrite all thirteen in the vocabulary**

- [ ] **Step 2: Run the golden test**

Run: `npx vitest run packages/core/test/motion/golden.test.ts`
Expected: PASS with no change to `golden.json`. A diff here is a re-tune, not a refactor.

- [ ] **Step 3: Commit**

---

### Task 6: Compositor layers and out-param

**Files:**
- Modify: `packages/core/src/motion/compositor.ts`, `packages/core/src/render/word.ts`
- Test: `packages/core/test/motion/compositor.test.ts`

- [ ] **Step 1: Write the failing tests**

A layered slot sums its pieces, takes the longest duration, and reports `envRotation` if any
member sets it. `poseAt(elapsed, letter, out)` writes into `out` and returns it.

- [ ] **Step 2: Implement, run the golden, commit**

---

### Task 7: Extension point

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Export the vocabulary and widen FireOptions**

`Name | MotionPiece | MotionPiece[]` for `enter`, `active` and `exit`. `ENV_DRIVEN` is replaced
by reading `envRotation` off the resolved piece.

- [ ] **Step 2: Test a caller-supplied piece, including one with `envRotation`**

- [ ] **Step 3: Run `npm run check`, update the README, commit**
