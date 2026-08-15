# blitsklieg core v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@blitsklieg/core` — a transparent WebGL overlay that renders shiny extruded 3D
type over a host web app, driven by `enter`/`active`/`exit` motion slots.

**Architecture:** A pure-logic layer (clock, easing, pose algebra, phase compositor, queue) with
no three.js dependency and full unit tests, wrapped by a thin three.js rendering layer (glyph
geometry, environment, materials, render paths). One mesh per letter so per-letter motion and
glyph caching both work. Everything reads time from an injected clock, which is what makes the
motion testable at all.

**Tech Stack:** TypeScript, three.js r170+, opentype.js, Vite, Vitest, Biome, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-15-blitsklieg-design.md`

---

## File Structure

```
packages/core/
  src/
    index.ts              public surface: createBlitsklieg, names, types, direct render path
    clock.ts              Clock interface, RafClock, ManualClock
    easing.ts             easing curves
    pose.ts               Pose, PoseOffset, algebra
    motion/
      types.ts            MotionPiece, LetterInfo
      enter.ts            slam, spin, flip, assemble, rise
      active.ts           sweep, float, pulse, shimmer
      exit.ts             shatter, drop, recede, fade
      compositor.ts       phase timeline + weighted accumulation
    queue.ts              serial effect queue
    text/
      font.ts             opentype.js loading
      glyphs.ts           glyph -> ExtrudeGeometry, cached (the one three.js file under text/)
      layout.ts           kerned advances, viewport fit
    render/
      environment.ts      procedural cubemap
      looks.ts            material presets
      stage.ts            renderer, scene, camera, lifecycle
      bloom.ts            RT chain + alpha-preserving composite
  test/                   mirrors src/
apps/lab/                 Vite demo page
```

Pure logic (`clock`, `easing`, `pose`, `motion/`, `queue`, `text/font`, `text/layout`) never
imports three.js. That boundary is what keeps the test suite fast and meaningful.

---

## Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`

- [ ] **Step 1: Root package.json**

```json
{
  "name": "blitsklieg-monorepo",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b",
    "lint": "biome check .",
    "check": "npm run lint && npm run typecheck && npm run test"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "composite": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"]
  }
}
```

- [ ] **Step 3: packages/core/package.json**

```json
{
  "name": "@blitsklieg/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "opentype.js": "^1.3.4",
    "three": "^0.170.0"
  },
  "devDependencies": {
    "@types/opentype.js": "^1.3.10",
    "@types/three": "^0.170.0"
  }
}
```

`opentype.js` ships no type declarations, so without `@types/opentype.js` Task 12's import fails
with TS7016 and no code change can fix it — `skipLibCheck` does not apply, because the error is
raised on the importing file. `private: true` prevents publishing a package whose `main` is raw
TypeScript; Task 16 removes it alongside real `exports`/`types`/`files` wiring.

- [ ] **Step 4: packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src", "test"]
}
```

- [ ] **Step 5: biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "quoteStyle": "single" } },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "files": { "ignore": ["dist", "node_modules", "spikes"] }
}
```

The `quoteStyle` line is load-bearing. Biome defaults to double quotes, and every code block in
this plan is written with single quotes — without it, `npm run lint` rejects every task's output.

- [ ] **Step 6: vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/*/test/**/*.test.ts'], environment: 'node' },
});
```

- [ ] **Step 7: Root tsconfig.json**

`tsc -b` with no arguments needs a solution-style root that references the composite project.
Without it, `npm run typecheck` fails with TS5083 no matter how much source exists.

```json
{
  "files": [],
  "references": [{ "path": "packages/core" }]
}
```

`apps/lab` appends a second reference in Task 18.

- [ ] **Step 8: Install and verify**

Run: `npm install && npm run lint`
Expected: biome reports no errors.

**`npm run test` and `npm run typecheck` are both expected to FAIL after this task, and that is
correct.** Vitest exits nonzero with no test files; `tsc -b` reports TS18003 because
`packages/core` has no inputs yet. Task 2 creates the first source and test file, which turns
both green. Do not create empty directories, `.gitkeep`, or placeholder source files to force
them green — empty directories are not tracked by git and would not satisfy TypeScript anyway.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "scaffold npm workspace with typescript, biome, vitest"
```

---

## Task 2: Clock

The injected clock is load-bearing: no motion below is testable without it.

**Files:**
- Create: `packages/core/src/clock.ts`
- Test: `packages/core/test/clock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';

describe('ManualClock', () => {
  it('starts at zero', () => {
    expect(new ManualClock().now()).toBe(0);
  });

  it('advances by the given delta', () => {
    const c = new ManualClock();
    c.advance(16);
    c.advance(16);
    expect(c.now()).toBe(32);
  });

  it('runs subscribed callbacks once per advance, with the current time', () => {
    const c = new ManualClock();
    const seen: number[] = [];
    c.subscribe((t) => seen.push(t));
    c.advance(10);
    c.advance(5);
    expect(seen).toEqual([10, 15]);
  });

  it('stops calling a callback after unsubscribe', () => {
    const c = new ManualClock();
    const seen: number[] = [];
    const off = c.subscribe((t) => seen.push(t));
    c.advance(10);
    off();
    c.advance(10);
    expect(seen).toEqual([10]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/clock.test.ts`
Expected: FAIL — cannot find module `../src/clock.js`.

- [ ] **Step 3: Implement**

```ts
export type Tick = (nowMs: number) => void;
export type Unsubscribe = () => void;

export interface Clock {
  now(): number;
  subscribe(fn: Tick): Unsubscribe;
}

export class ManualClock implements Clock {
  private t = 0;
  private subs = new Set<Tick>();

  now(): number {
    return this.t;
  }

  subscribe(fn: Tick): Unsubscribe {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  advance(deltaMs: number): void {
    this.t += deltaMs;
    // The copy stops a self-subscribing callback from looping forever; the membership check
    // stops it from resurrecting a peer that unsubscribed earlier in this same tick, which
    // under the `replace` queue policy is a use-after-dispose.
    for (const fn of [...this.subs]) {
      if (!this.subs.has(fn)) continue;
      fn(this.t);
    }
  }
}

export class RafClock implements Clock {
  private subs = new Set<Tick>();
  private raf: number | null = null;
  private readonly origin = performance.now();

  // Live, not stored. Consumers sample now() BEFORE subscribing and difference it against
  // ticks; a stored `t` reads 0 until the first frame, making that difference a page-relative
  // timestamp and finishing every animation on frame one. ManualClock would still pass.
  now(): number {
    return performance.now() - this.origin;
  }

  subscribe(fn: Tick): Unsubscribe {
    this.subs.add(fn);
    if (this.raf === null) this.start();
    return () => {
      this.subs.delete(fn);
      if (this.subs.size === 0) this.stop();
    };
  }

  private start(): void {
    const loop = (t: number) => {
      // Reschedule FIRST: a throwing subscriber must not be able to kill the loop.
      this.raf = requestAnimationFrame(loop);
      const now = Math.max(0, t - this.origin);
      for (const fn of [...this.subs]) {
        if (!this.subs.has(fn)) continue; // unsubscribed earlier in this same tick
        try {
          fn(now);
        } catch (err) {
          queueMicrotask(() => {
            throw err;
          });
        }
      }
      // A subscriber may have unsubscribed itself above, after start() was decided.
      if (this.subs.size === 0) this.stop();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}
```

`RafClock` must be tested, not just `ManualClock`. Stub `globalThis.requestAnimationFrame` with a
manual frame pump and `vi.spyOn(performance, 'now')` — no DOM needed. Cover: `now()` sampled
before subscribe differences to near zero against the first tick; the same after an idle gap and
a second subscribe cycle; a throwing subscriber neither blocks peers nor stops the loop; the last
subscriber unsubscribing inside a tick leaves no pending frame; a peer unsubscribed mid-tick is
not called that tick.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/clock.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/clock.ts packages/core/test/clock.test.ts
git commit -m "add injectable clock with manual and raf implementations"
```

---

## Task 3: Easing

**Files:**
- Create: `packages/core/src/easing.ts`
- Test: `packages/core/test/easing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { backOut, easeInCubic, easeOutCubic, linear } from '../src/easing.js';

const CURVES = { linear, easeOutCubic, easeInCubic, backOut };

describe('easing', () => {
  it('every curve is pinned at both endpoints', () => {
    for (const [name, fn] of Object.entries(CURVES)) {
      expect(fn(0), `${name}(0)`).toBeCloseTo(0, 6);
      expect(fn(1), `${name}(1)`).toBeCloseTo(1, 6);
    }
  });

  it('backOut overshoots past 1 before settling', () => {
    const peak = Math.max(...Array.from({ length: 99 }, (_, i) => backOut((i + 1) / 100)));
    expect(peak).toBeGreaterThan(1);
  });

  it('easeOutCubic is past halfway at t=0.5', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('easeInCubic is short of halfway at t=0.5', () => {
    expect(easeInCubic(0.5)).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/easing.test.ts`
Expected: FAIL — cannot find module `../src/easing.js`.

- [ ] **Step 3: Implement**

```ts
export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;

export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;

export const easeInCubic: Easing = (t) => t ** 3;

export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

// Overshoots past 1 then settles. The two constants must differ: with a single shared c the
// cubic and quadratic terms cancel at t=0, pinning the curve to 1.0 and flattening its range
// to [1.0, 1.281] — an entrance that never enters.
export const backOut: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = t - 1;
  return 1 + c3 * p ** 3 + c1 * p ** 2;
};

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/easing.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/easing.ts packages/core/test/easing.test.ts
git commit -m "add easing curves"
```

---

## Task 4: Pose algebra

Poses are absolute; offsets are relative contributions from motion pieces. Keeping these two
types distinct is what prevents a phase from writing absolute transforms.

**Files:**
- Create: `packages/core/src/pose.ts`
- Test: `packages/core/test/pose.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { REST, accumulate, scaleOffset } from '../src/pose.js';

describe('pose algebra', () => {
  it('accumulating no offsets leaves the rest pose untouched', () => {
    expect(accumulate(REST, [])).toEqual(REST);
  });

  it('adds positions and rotations, multiplies scale and opacity', () => {
    const p = accumulate(REST, [
      { position: [1, 2, 3], rotation: [0, 0.5, 0], scale: 2, opacity: 0.5 },
      { position: [1, 0, 0], rotation: [0, 0.5, 0], scale: 3, opacity: 0.5 },
    ]);
    expect(p.position).toEqual([2, 2, 3]);
    expect(p.rotation).toEqual([0, 1, 0]);
    expect(p.scale).toBe(6);
    expect(p.opacity).toBe(0.25);
  });

  it('treats omitted fields as identity', () => {
    expect(accumulate(REST, [{ scale: 2 }])).toEqual({ ...REST, scale: 2 });
  });

  it('scaleOffset at weight 0 is the identity offset', () => {
    const o = scaleOffset({ position: [4, 4, 4], scale: 3, opacity: 0 }, 0);
    expect(accumulate(REST, [o])).toEqual(REST);
  });

  it('scaleOffset at weight 1 is unchanged', () => {
    const o = { position: [4, 0, 0] as [number, number, number], scale: 3 };
    expect(scaleOffset(o, 1)).toEqual(o);
  });

  it('scaleOffset interpolates scale toward 1, not toward 0', () => {
    expect(scaleOffset({ scale: 3 }, 0.5).scale).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/pose.test.ts`
Expected: FAIL — cannot find module `../src/pose.js`.

- [ ] **Step 3: Implement**

```ts
export type Vec3 = [number, number, number];

export interface Pose {
  position: Vec3;
  rotation: Vec3;
  scale: number;
  opacity: number;
}

/** A relative contribution. Omitted fields mean "no contribution". */
export interface PoseOffset {
  position?: Vec3;
  rotation?: Vec3;
  scale?: number;
  opacity?: number;
}

export const REST: Pose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  opacity: 1,
};

export function accumulate(base: Pose, offsets: readonly PoseOffset[]): Pose {
  const position: Vec3 = [...base.position];
  const rotation: Vec3 = [...base.rotation];
  let scale = base.scale;
  let opacity = base.opacity;

  // The casts are safe because Vec3 is a fixed 3-tuple. Both sides need one: under
  // noUncheckedIndexedAccess a compound assignment widens its LHS read too, so `+=` alone
  // does not compile.
  for (const o of offsets) {
    if (o.position)
      for (let i = 0; i < 3; i++) position[i] = (position[i] as number) + (o.position[i] as number);
    if (o.rotation)
      for (let i = 0; i < 3; i++) rotation[i] = (rotation[i] as number) + (o.rotation[i] as number);
    if (o.scale !== undefined) scale *= o.scale;
    if (o.opacity !== undefined) opacity *= o.opacity;
  }

  return { position, rotation, scale, opacity };
}

/**
 * Fade an offset toward identity. Additive fields go to 0; multiplicative fields go to 1 —
 * scaling them toward 0 would collapse the word instead of removing the contribution.
 */
export function scaleOffset(o: PoseOffset, weight: number): PoseOffset {
  const out: PoseOffset = {};
  if (o.position) out.position = o.position.map((v) => v * weight) as Vec3;
  if (o.rotation) out.rotation = o.rotation.map((v) => v * weight) as Vec3;
  if (o.scale !== undefined) out.scale = 1 + (o.scale - 1) * weight;
  if (o.opacity !== undefined) out.opacity = 1 + (o.opacity - 1) * weight;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/pose.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pose.ts packages/core/test/pose.test.ts
git commit -m "add pose algebra separating absolute poses from relative offsets"
```

---

## Task 5: Motion piece types

**Files:**
- Create: `packages/core/src/motion/types.ts`
- Test: `packages/core/test/motion/types.test.ts`

- [ ] **Step 1: Write the types**

This file is not types-only: `stagger` is real math with a divide, and `NONE` is a real value.
Test both. The saturation property in particular — every letter reaching exactly 1 at `t = 1` —
is what Tasks 6–8 rely on when they assert each piece lands on the rest pose, so assert it here
rather than discovering it three tasks later.

```ts
import type { PoseOffset } from '../pose.js';

export interface LetterInfo {
  /** 0-based position in the word, whitespace included. */
  index: number;
  /** Total letters in the word. */
  count: number;
}

export interface MotionPiece {
  /** Milliseconds for one pass. `active` pieces loop; `enter`/`exit` run once. */
  duration: number;
  /** `t` is normalized 0..1 within this pass. */
  offset(t: number, letter: LetterInfo): PoseOffset;
}

export type EnterName = 'slam' | 'spin' | 'flip' | 'assemble' | 'rise' | 'none';
export type ActiveName = 'sweep' | 'float' | 'pulse' | 'shimmer' | 'none';
export type ExitName = 'shatter' | 'drop' | 'recede' | 'fade' | 'none';

/** Stagger helper: returns 0..1 for how far along letter `index` should be at word-time `t`. */
export function stagger(t: number, letter: LetterInfo, spread = 0.5): number {
  const count = Math.max(1, letter.count);
  const start = (letter.index / count) * spread;
  // spread=1 would make span 0, and (t - start) is also 0 at t=start — 0/0 is NaN, which
  // clamps straight through into a transform and makes the letter vanish silently.
  const span = Math.max(1e-6, 1 - spread);
  return Math.max(0, Math.min(1, (t - start) / span));
}

export const NONE: MotionPiece = { duration: 0, offset: () => ({}) };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b packages/core`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/motion/types.ts
git commit -m "add motion piece types and stagger helper"
```

---

## Task 6: Enter pieces

**Files:**
- Create: `packages/core/src/motion/enter.ts`
- Test: `packages/core/test/motion/enter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ENTER } from '../../src/motion/enter.js';
import { REST, accumulate } from '../../src/pose.js';

const L = { index: 0, count: 6 };
const LAST = { index: 5, count: 6 };

describe('enter pieces', () => {
  it('every piece lands on the rest pose at t=1', () => {
    for (const [name, piece] of Object.entries(ENTER)) {
      for (const letter of [L, LAST]) {
        const p = accumulate(REST, [piece.offset(1, letter)]);
        expect(p.position, `${name} position`).toEqual([0, 0, 0]);
        expect(p.scale, `${name} scale`).toBeCloseTo(1, 5);
        expect(p.opacity, `${name} opacity`).toBeCloseTo(1, 5);
      }
    }
  });

  it('every piece starts displaced from rest at t=0', () => {
    for (const [name, piece] of Object.entries(ENTER)) {
      if (name === 'none') continue; // `none` contributes nothing by definition
      const o = piece.offset(0, L);
      const moved =
        (o.position?.some((v) => v !== 0) ?? false) ||
        (o.rotation?.some((v) => v !== 0) ?? false) ||
        (o.scale !== undefined && o.scale !== 1) ||
        (o.opacity !== undefined && o.opacity !== 1);
      expect(moved, `${name} should displace at t=0`).toBe(true);
    }
  });

  it('slam approaches from behind the camera and overshoots', () => {
    expect(ENTER.slam.offset(0, L).position?.[2]).toBeLessThan(0);
    const zs = Array.from({ length: 50 }, (_, i) => ENTER.slam.offset(i / 49, L).position?.[2] ?? 0);
    expect(Math.max(...zs)).toBeGreaterThan(0);
  });

  it('spin staggers: the last letter lags the first', () => {
    const first = Math.abs(ENTER.spin.offset(0.4, L).rotation?.[1] ?? 0);
    const last = Math.abs(ENTER.spin.offset(0.4, LAST).rotation?.[1] ?? 0);
    expect(last).toBeGreaterThan(first);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/motion/enter.test.ts`
Expected: FAIL — cannot find module `../../src/motion/enter.js`.

- [ ] **Step 3: Implement**

```ts
import { backOut, easeOutCubic } from '../easing.js';
import type { PoseOffset } from '../pose.js';
import { type EnterName, type MotionPiece, NONE, stagger } from './types.js';

const slam: MotionPiece = {
  duration: 900,
  offset(t): PoseOffset {
    const e = backOut(t);
    return { position: [0, 0, (e - 1) * 26], scale: 0.55 + 0.45 * e };
  },
};

const spin: MotionPiece = {
  duration: 1100,
  offset(t, letter): PoseOffset {
    const s = stagger(t, letter, 0.55);
    const e = easeOutCubic(s);
    return { rotation: [0, (1 - e) * Math.PI * 2, 0], opacity: e };
  },
};

const flip: MotionPiece = {
  duration: 1000,
  offset(t, letter): PoseOffset {
    const s = stagger(t, letter, 0.6);
    const e = easeOutCubic(s);
    return { rotation: [(1 - e) * -Math.PI, 0, 0], opacity: e < 0.05 ? 0 : 1 };
  },
};

const assemble: MotionPiece = {
  duration: 1200,
  offset(t, letter): PoseOffset {
    const e = easeOutCubic(t);
    // Deterministic per-letter scatter: no RNG, so tests and screenshots stay stable.
    const a = letter.index * 2.399963;
    return {
      position: [(1 - e) * Math.cos(a) * 9, (1 - e) * Math.sin(a) * 6, (1 - e) * Math.sin(a * 2) * 5],
      rotation: [(1 - e) * a, (1 - e) * a * 0.7, 0],
      opacity: easeOutCubic(Math.min(1, t * 2)),
    };
  },
};

const rise: MotionPiece = {
  duration: 900,
  offset(t, letter): PoseOffset {
    const s = stagger(t, letter, 0.35);
    const e = backOut(s);
    return { position: [0, (e - 1) * 5, 0], opacity: Math.min(1, s * 3) };
  },
};

export const ENTER: Record<EnterName, MotionPiece> = {
  slam,
  spin,
  flip,
  assemble,
  rise,
  none: NONE,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/motion/enter.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/motion/enter.ts packages/core/test/motion/enter.test.ts
git commit -m "add five enter motion pieces"
```

---

## Task 7: Active pieces

Active pieces loop, so they must be **seamless**: `offset(0)` and `offset(1)` have to match, or the
word visibly jumps once per cycle.

**Files:**
- Create: `packages/core/src/motion/active.ts`
- Test: `packages/core/test/motion/active.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ACTIVE } from '../../src/motion/active.js';
import type { MotionPiece } from '../../src/motion/types.js';

const L = { index: 2, count: 6 };

// Seamlessness must be checked with a tolerance, not toEqual. Math.sin(2*PI) is -2.45e-16,
// not 0, so exact comparison fails for every sine-driven piece — which is most of them.
function expectSeamless(name: string, piece: MotionPiece): void {
  const a = piece.offset(0, L);
  const b = piece.offset(1, L);
  expect(Object.keys(a).sort(), `${name} contributes different keys at 0 and 1`).toEqual(
    Object.keys(b).sort(),
  );
  for (const k of ['position', 'rotation'] as const) {
    for (let i = 0; i < 3; i++) {
      expect(a[k]?.[i] ?? 0, `${name}.${k}[${i}]`).toBeCloseTo(b[k]?.[i] ?? 0, 9);
    }
  }
  for (const k of ['scale', 'opacity'] as const) {
    expect(a[k] ?? 1, `${name}.${k}`).toBeCloseTo(b[k] ?? 1, 9);
  }
}

describe('active pieces', () => {
  it('loop seamlessly: offset(0) matches offset(1)', () => {
    for (const [name, piece] of Object.entries(ACTIVE)) expectSeamless(name, piece);
  });

  it('stay near rest — active is an idle, not a journey', () => {
    for (const [name, piece] of Object.entries(ACTIVE)) {
      for (let i = 0; i <= 20; i++) {
        const o = piece.offset(i / 20, L);
        for (const v of o.position ?? []) {
          expect(Math.abs(v), `${name} position`).toBeLessThan(0.6);
        }
        if (o.scale !== undefined) expect(Math.abs(o.scale - 1), `${name} scale`).toBeLessThan(0.15);
      }
    }
  });

  it('none contributes nothing', () => {
    expect(ACTIVE.none.offset(0.5, L)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/motion/active.test.ts`
Expected: FAIL — cannot find module `../../src/motion/active.js`.

- [ ] **Step 3: Implement**

```ts
import type { PoseOffset } from '../pose.js';
import { type ActiveName, type MotionPiece, NONE } from './types.js';

const TAU = Math.PI * 2;

// `sweep` contributes no transform. It exists so the stage knows to rotate the environment,
// which is what actually rakes the highlight across the letters.
const sweep: MotionPiece = {
  duration: 3400,
  offset(): PoseOffset {
    return {};
  },
};

const float: MotionPiece = {
  duration: 5200,
  offset(t): PoseOffset {
    return {
      position: [0, Math.sin(t * TAU) * 0.12, 0],
      rotation: [Math.sin(t * TAU * 2) * 0.03, Math.sin(t * TAU) * 0.1, 0],
    };
  },
};

const pulse: MotionPiece = {
  duration: 1600,
  offset(t): PoseOffset {
    return { scale: 1 + Math.sin(t * TAU) * 0.035 };
  },
};

const shimmer: MotionPiece = {
  duration: 2600,
  offset(t, letter): PoseOffset {
    const phase = t * TAU + (letter.index / Math.max(1, letter.count)) * TAU;
    return { rotation: [0, Math.sin(phase) * 0.05, 0] };
  },
};

export const ACTIVE: Record<ActiveName, MotionPiece> = {
  sweep,
  float,
  pulse,
  shimmer,
  none: NONE,
};

/** Active pieces that drive the environment rather than the transform. */
export const ENV_DRIVEN: ReadonlySet<ActiveName> = new Set<ActiveName>(['sweep']);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/motion/active.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/motion/active.ts packages/core/test/motion/active.test.ts
git commit -m "add four looping active motion pieces"
```

---

## Task 8: Exit pieces

**Files:**
- Create: `packages/core/src/motion/exit.ts`
- Test: `packages/core/test/motion/exit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { EXIT } from '../../src/motion/exit.js';
import { REST, accumulate } from '../../src/pose.js';

const L = { index: 1, count: 6 };

describe('exit pieces', () => {
  it('every piece starts at the rest pose at t=0', () => {
    for (const [name, piece] of Object.entries(EXIT)) {
      const p = accumulate(REST, [piece.offset(0, L)]);
      expect(p.position, `${name} position`).toEqual([0, 0, 0]);
      expect(p.scale, `${name} scale`).toBeCloseTo(1, 5);
      expect(p.opacity, `${name} opacity`).toBeCloseTo(1, 5);
    }
  });

  it('every piece except none is fully invisible at t=1', () => {
    for (const [name, piece] of Object.entries(EXIT)) {
      if (name === 'none') continue;
      expect(accumulate(REST, [piece.offset(1, L)]).opacity, `${name}`).toBeCloseTo(0, 5);
    }
  });

  it('drop accelerates downward rather than moving linearly', () => {
    const first = Math.abs(EXIT.drop.offset(0.25, L).position?.[1] ?? 0);
    const later = Math.abs(EXIT.drop.offset(0.75, L).position?.[1] ?? 0);
    expect(later).toBeGreaterThan(first * 3);
  });

  it('shatter throws letters apart in different directions', () => {
    const a = EXIT.shatter.offset(1, { index: 0, count: 6 }).position?.[0] ?? 0;
    const b = EXIT.shatter.offset(1, { index: 3, count: 6 }).position?.[0] ?? 0;
    expect(a).not.toBeCloseTo(b, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/motion/exit.test.ts`
Expected: FAIL — cannot find module `../../src/motion/exit.js`.

- [ ] **Step 3: Implement**

```ts
import { easeInCubic, easeOutCubic } from '../easing.js';
import type { PoseOffset } from '../pose.js';
import { type ExitName, type MotionPiece, NONE } from './types.js';

const shatter: MotionPiece = {
  duration: 800,
  offset(t, letter): PoseOffset {
    const e = easeOutCubic(t);
    const a = letter.index * 2.399963;
    return {
      position: [Math.cos(a) * 10 * e, Math.sin(a) * 7 * e, Math.sin(a * 3) * 6 * e],
      rotation: [a * e * 3, a * e * 2, a * e],
      opacity: 1 - easeInCubic(t),
    };
  },
};

const drop: MotionPiece = {
  duration: 700,
  offset(t, letter): PoseOffset {
    const g = t * t; // gravity
    return {
      position: [0, -22 * g, 0],
      rotation: [0, 0, g * (letter.index % 2 === 0 ? 0.9 : -0.9)],
      opacity: 1 - easeInCubic(t),
    };
  },
};

const recede: MotionPiece = {
  duration: 650,
  offset(t): PoseOffset {
    const e = easeInCubic(t);
    return { position: [0, 0, -30 * e], scale: 1 - 0.5 * e, opacity: 1 - e };
  },
};

const fade: MotionPiece = {
  duration: 500,
  offset(t): PoseOffset {
    return { opacity: 1 - t, scale: 1 + 0.06 * t };
  },
};

export const EXIT: Record<ExitName, MotionPiece> = {
  shatter,
  drop,
  recede,
  fade,
  none: NONE,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/motion/exit.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/motion/exit.ts packages/core/test/motion/exit.test.ts
git commit -m "add four exit motion pieces"
```

---

## Task 9: Phase compositor

The spec's central motion decision. Phases contribute weighted offsets over the rest pose, with a
crossfade window so a phase's tail overlaps the next phase's head. Two ramps at one boundary are
complementary and sum to 1, but a `hold` shorter than `blendMs` puts all three phases in their
ramps at once and the total runs past 1, so `poseAt` normalizes whenever the sum exceeds 1.

Zero-length phases are dropped at construction rather than guarded at each read, so a zero-length
segment can never reach the `0/0` in `localT`; an `active: 'none'` slot still spans the hold and
survives the filter, and its `d <= 0` guard is what catches it. `duration` is computed before the
filter, so the pins that hold the outermost phases at full weight still find their segments. Those
pins skip the window guard too — a phase pinned to an edge holds past it, so the final frame at
exactly `duration` renders the exit's end pose instead of snapping back to rest.

**Files:**
- Create: `packages/core/src/motion/compositor.ts`
- Test: `packages/core/test/motion/compositor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { Timeline, type TimelineOptions } from '../../src/motion/compositor.js';
import type { MotionPiece } from '../../src/motion/types.js';
import { REST } from '../../src/pose.js';

const piece = (duration: number, x: number): MotionPiece => ({
  duration,
  offset: () => ({ position: [x, 0, 0] }),
});

const build = (hold = 100) =>
  new Timeline({
    enter: piece(100, 1),
    active: piece(50, 10),
    exit: piece(100, 100),
    hold,
    blendMs: 20,
  });

const L = { index: 0, count: 1 };

/** Every phase contributes 1, so `poseAt(t).position[0]` reads back the total phase weight. */
const unit = (duration: number): MotionPiece => ({
  duration,
  offset: () => ({ position: [1, 0, 0] }),
});

const expectUnitWeight = (over: Partial<TimelineOptions> = {}) => {
  const tl = new Timeline({
    enter: unit(100),
    active: unit(50),
    exit: unit(100),
    hold: 100,
    blendMs: 20,
    ...over,
  });
  for (let t = 0; t <= tl.duration; t += 1) {
    expect(tl.poseAt(t, L).position[0], `t=${t}`).toBeCloseTo(1);
  }
};

describe('Timeline', () => {
  it('reports total duration as enter + hold + exit', () => {
    expect(build(100).duration).toBe(300);
  });

  it('is finished only past the end', () => {
    const tl = build();
    expect(tl.isFinished(299)).toBe(false);
    expect(tl.isFinished(300)).toBe(true);
  });

  it('applies only enter in the middle of the enter phase', () => {
    expect(build().poseAt(50, L).position[0]).toBe(1);
  });

  it('applies only active in the middle of the hold', () => {
    expect(build().poseAt(150, L).position[0]).toBe(10);
  });

  it('blends both phases evenly at the midpoint of the crossfade window', () => {
    // Halfway through the 20ms window straddling the enter/active boundary at t=100:
    // 0.5 of enter's 1, plus 0.5 of active's 10 sampled at its loop start.
    expect(build().poseAt(100, L).position[0]).toBeCloseTo(5.5);
  });

  it('holds total phase weight at 1 for the whole timeline', () => {
    expectUnitWeight();
  });

  it('loops the active piece rather than running it once', () => {
    const tl = build(200);
    // active duration is 50ms, so 120ms and 170ms into the hold are the same phase point
    expect(tl.poseAt(220, L)).toEqual(tl.poseAt(270, L));
  });

  it('samples the looping active piece at its wrapped phase point', () => {
    const tl = new Timeline({
      enter: piece(100, 1),
      active: { duration: 50, offset: (t) => ({ position: [t, 0, 0] }) },
      exit: piece(100, 100),
      hold: 200,
      blendMs: 20,
    });
    expect(tl.poseAt(160, L).position[0]).toBe(0.2);
    expect(tl.poseAt(210, L).position[0]).toBe(0.2);
    expect(tl.poseAt(185, L).position[0]).toBe(0.7);
  });
});

describe('Timeline with degenerate durations', () => {
  const degenerate = (over: Partial<TimelineOptions>) =>
    new Timeline({
      enter: piece(100, 1),
      active: piece(50, 10),
      exit: piece(100, 100),
      hold: 100,
      blendMs: 20,
      ...over,
    });

  it('gives a zero-length phase no weight at all', () => {
    const tl = degenerate({ enter: piece(0, 1) });
    expect(tl.duration).toBe(200);
    expect(tl.poseAt(0, L).position[0]).toBe(10);
    expectUnitWeight({ enter: unit(0) });
  });

  it('covers the whole timeline when the hold is zero', () => {
    const tl = degenerate({ hold: 0 });
    expect(tl.duration).toBe(200);
    expectUnitWeight({ hold: 0 });
  });

  it('does not overshoot when the hold is shorter than the blend window', () => {
    expectUnitWeight({ hold: 10 });
  });

  it('hands over cleanly at every boundary with no blend window', () => {
    const tl = degenerate({ blendMs: 0 });
    expectUnitWeight({ blendMs: 0 });
    expect(tl.poseAt(99, L).position[0]).toBe(1);
    expect(tl.poseAt(100, L).position[0]).toBe(10);
    expect(tl.poseAt(199, L).position[0]).toBe(10);
    expect(tl.poseAt(200, L).position[0]).toBe(100);
  });

  it('is finished immediately when every phase is empty', () => {
    const tl = degenerate({
      enter: piece(0, 1),
      active: piece(0, 10),
      exit: piece(0, 100),
      hold: 0,
    });
    expect(tl.duration).toBe(0);
    expect(tl.isFinished(0)).toBe(true);
    expect(tl.poseAt(0, L)).toEqual(REST);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/motion/compositor.test.ts`
Expected: FAIL — cannot find module `../../src/motion/compositor.js`.

- [ ] **Step 3: Implement**

```ts
import { type Pose, type PoseOffset, REST, accumulate, scaleOffset } from '../pose.js';
import type { LetterInfo, MotionPiece } from './types.js';

export interface TimelineOptions {
  enter: MotionPiece;
  active: MotionPiece;
  exit: MotionPiece;
  /** Milliseconds spent in the active phase. */
  hold: number;
  /** Crossfade window straddling each phase boundary. */
  blendMs: number;
}

interface Segment {
  piece: MotionPiece;
  start: number;
  end: number;
  loop: boolean;
}

export class Timeline {
  readonly duration: number;
  private readonly segments: Segment[];
  private readonly blend: number;

  constructor(opts: TimelineOptions) {
    const enterEnd = opts.enter.duration;
    const activeEnd = enterEnd + opts.hold;
    this.duration = activeEnd + opts.exit.duration;
    this.blend = opts.blendMs;
    this.segments = [
      { piece: opts.enter, start: 0, end: enterEnd, loop: false },
      { piece: opts.active, start: enterEnd, end: activeEnd, loop: true },
      { piece: opts.exit, start: activeEnd, end: this.duration, loop: false },
    ].filter((seg) => seg.end > seg.start);
  }

  isFinished(elapsed: number): boolean {
    return elapsed >= this.duration;
  }

  poseAt(elapsed: number, letter: LetterInfo): Pose {
    const parts: { seg: Segment; weight: number }[] = [];
    let total = 0;

    for (const seg of this.segments) {
      const weight = this.weight(seg, elapsed);
      if (weight <= 0) continue;
      parts.push({ seg, weight });
      total += weight;
    }

    // Pairwise-complementary ramps sum to 1, but a `hold` shorter than `blendMs` overlaps all
    // three phases at once and the total runs past 1 — which reads as the word lurching.
    const norm = total > 1 ? 1 / total : 1;
    const offsets: PoseOffset[] = parts.map(({ seg, weight }) =>
      scaleOffset(seg.piece.offset(this.localT(seg, elapsed), letter), weight * norm),
    );

    return accumulate(REST, offsets);
  }

  /** Ramps 0→1 over the blend window at the segment's leading edge and back down at its trailing. */
  private weight(seg: Segment, elapsed: number): number {
    const half = this.blend / 2;
    const head = seg.start - half;
    const tail = seg.end + half;

    // Whichever phase starts at 0 and whichever ends at `duration` hold full weight past that edge
    // rather than fading to nothing; a zero-length enter makes `active` the former. Windowing them
    // would drop the word to rest on the last frame, which callers clamp to exactly `duration`.
    const atStart = seg.start === 0;
    const atEnd = seg.end === this.duration;
    if ((!atStart && elapsed < head) || (!atEnd && elapsed >= tail)) return 0;

    const inW = atStart ? 1 : this.ramp(elapsed - head);
    const outW = atEnd ? 1 : this.ramp(tail - elapsed);
    return Math.min(inW, outW);
  }

  private ramp(into: number): number {
    return this.blend > 0 ? Math.min(1, into / this.blend) : 1;
  }

  private localT(seg: Segment, elapsed: number): number {
    const into = elapsed - seg.start;

    if (seg.loop) {
      const d = seg.piece.duration;
      if (d <= 0) return 0;
      return (((into % d) + d) % d) / d;
    }

    return Math.max(0, Math.min(1, into / (seg.end - seg.start)));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/motion/compositor.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/motion/compositor.ts packages/core/test/motion/compositor.test.ts
git commit -m "add phase compositor with weighted crossfade between motion slots"
```

---

## Task 10: Effect queue

Which effect plays when a second `fire()` arrives: wait its turn, kill the one in flight, or run
alongside. An effect the queue drops before it starts resolves rather than rejects — it is done,
not failed — while one already running settles however its runner settles, so `fire()` still needs
a rejection handler.

`cancelAll()` returns a promise that resolves once every aborted effect has torn down. Aborting
only signals: the runner notices on its next tick, so a `destroy()` that frees shared state on the
line after `cancelAll()` would be freeing it out from under a runner still using it.

`replace` means the newest fire wins outright: it aborts the running effect and drops anything
still queued behind it, since a `replace` that keeps a backlog is `queue` with an extra abort.

`push` starts a drain loop only when no loop is already running, which is what the `draining` flag
tracks. Gating on the empty effect slot instead is wrong: an effect's completion handler can push
while the loop sits suspended between entries, starting a second loop that runs two effects at
once. Since the serial policies start effects only from inside that one loop, a replacement's `run`
is never called until the aborted effect's promise settles — that is what lets Task 16 dispose the
stage on abort before the next mount.

**Files:**
- Create: `packages/core/src/queue.ts`
- Test: `packages/core/test/queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { EffectQueue } from '../src/queue.js';

/** Resolves when aborted, so a test never waits on a timer for teardown it does not care about. */
const abortable = (signal: AbortSignal) =>
  new Promise<void>((r) => {
    signal.addEventListener('abort', () => r());
  });

describe('EffectQueue', () => {
  it('runs one effect at a time and reports what is current', async () => {
    const q = new EffectQueue('queue');
    const order: string[] = [];
    const a = q.push('a', async () => {
      order.push('a');
    });
    const b = q.push('b', async () => {
      order.push('b');
    });
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
    expect(q.current).toBeNull();
  });

  it('replace policy cancels the running effect', async () => {
    const q = new EffectQueue('replace');
    const cancelled = vi.fn();
    const a = q.push('a', (signal) => {
      signal.addEventListener('abort', cancelled);
      return abortable(signal);
    });
    const b = q.push('b', async () => {});
    await Promise.all([a, b]);
    expect(cancelled).toHaveBeenCalled();
  });

  it('concurrent policy runs effects simultaneously', async () => {
    const q = new EffectQueue('concurrent');
    let peak = 0;
    let live = 0;
    const run = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 10));
      live--;
    };
    await Promise.all([q.push('a', run), q.push('b', run)]);
    expect(peak).toBe(2);
  });

  it('a rejecting effect does not stall the effects queued behind it', async () => {
    const q = new EffectQueue('queue');
    const order: string[] = [];
    const bad = q.push('bad', async () => {
      throw new Error('boom');
    });
    const good = q.push('good', async () => {
      order.push('good');
    });
    await expect(bad).rejects.toThrow('boom');
    await expect(good).resolves.toBeUndefined();
    expect(order).toEqual(['good']);
  });

  it('stays serial when a completion handler pushes two more effects', async () => {
    const q = new EffectQueue('queue');
    const order: string[] = [];
    let live = 0;
    let peak = 0;
    const run = (id: string) => async () => {
      live++;
      peak = Math.max(peak, live);
      order.push(id);
      await new Promise((r) => setTimeout(r, 5));
      live--;
    };

    const tail: Promise<void>[] = [];
    await q.push('a', run('a')).then(() => {
      tail.push(q.push('b', run('b')), q.push('c', run('c')));
    });
    await Promise.all(tail);

    expect(peak).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(q.current).toBeNull();
  });

  it('cancelAll resolves queued effects instead of leaving them unsettled', async () => {
    const q = new EffectQueue('queue');
    const aborted = vi.fn();
    const queuedRan = vi.fn();
    const a = q.push('a', (signal) => {
      signal.addEventListener('abort', aborted);
      return abortable(signal);
    });
    const b = q.push('b', async () => {
      queuedRan();
    });
    expect(q.current).toBe('a');

    await q.cancelAll();

    await expect(b).resolves.toBeUndefined();
    await a;
    expect(aborted).toHaveBeenCalled();
    expect(queuedRan).not.toHaveBeenCalled();
    expect(q.current).toBeNull();
  });

  it('cancelAll waits for the aborted effect to finish tearing down', async () => {
    const q = new EffectQueue('queue');
    const torn: string[] = [];
    const a = q.push(
      'a',
      (signal) =>
        new Promise<void>((r) => {
          signal.addEventListener('abort', () => {
            setTimeout(() => {
              torn.push('a');
              r();
            }, 10);
          });
        }),
    );

    await q.cancelAll();

    expect(torn).toEqual(['a']);
    expect(q.current).toBeNull();
    await expect(a).resolves.toBeUndefined();
  });

  it('cancelAll resolves even when an aborted effect rejects while tearing down', async () => {
    const q = new EffectQueue('queue');
    const a = q.push(
      'a',
      (signal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('teardown failed')));
        }),
    );
    const rejected = expect(a).rejects.toThrow('teardown failed');

    await expect(q.cancelAll()).resolves.toBeUndefined();

    await rejected;
    expect(q.current).toBeNull();
  });

  it('cancelAll clears a replace queue too', async () => {
    const q = new EffectQueue('replace');
    const supersededRan = vi.fn();
    const a = q.push('a', abortable);
    const b = q.push('b', async () => {
      supersededRan();
    });

    await q.cancelAll();

    await Promise.all([a, b]);
    expect(supersededRan).not.toHaveBeenCalled();
    expect(q.current).toBeNull();
  });

  it('cancelAll is not terminal — a later push still runs', async () => {
    const q = new EffectQueue('queue');
    const a = q.push('a', abortable);
    await q.cancelAll();
    await a;

    const ran = vi.fn();
    await q.push('b', async () => {
      ran();
    });
    expect(ran).toHaveBeenCalled();
  });

  it('cancelAll aborts in-flight concurrent effects', async () => {
    const q = new EffectQueue('concurrent');
    const aborted = vi.fn();
    const run = (signal: AbortSignal) => {
      signal.addEventListener('abort', aborted);
      return abortable(signal);
    };
    const both = Promise.all([q.push('a', run), q.push('b', run)]);

    await q.cancelAll();

    await both;
    expect(aborted).toHaveBeenCalledTimes(2);
    expect(q.current).toBeNull();
  });

  it('current names the most recently started effect still running', async () => {
    const q = new EffectQueue('concurrent');
    const release: Array<() => void> = [];
    const run = () => new Promise<void>((r) => release.push(r));

    expect(q.current).toBeNull();
    const a = q.push('a', run);
    expect(q.current).toBe('a');
    const b = q.push('b', run);
    expect(q.current).toBe('b');
    expect(release).toHaveLength(2);

    release[1]?.();
    await b;
    expect(q.current).toBe('a');
    release[0]?.();
    await a;
    expect(q.current).toBeNull();
  });

  it('replace starts the new effect only after the aborted one has torn down', async () => {
    const q = new EffectQueue('replace');
    const order: string[] = [];
    const a = q.push(
      'a',
      (signal) =>
        new Promise<void>((r) => {
          signal.addEventListener('abort', () => {
            setTimeout(() => {
              order.push('a:torn-down');
              r();
            }, 10);
          });
        }),
    );
    const b = q.push('b', async () => {
      order.push('b:started');
    });

    await Promise.all([a, b]);
    expect(order).toEqual(['a:torn-down', 'b:started']);
  });

  it('replace starts the new effect even when the aborted one rejects', async () => {
    const q = new EffectQueue('replace');
    const order: string[] = [];
    const a = q.push(
      'a',
      (signal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => {
            order.push('a:failed');
            reject(new Error('teardown failed'));
          });
        }),
    );
    const b = q.push('b', async () => {
      order.push('b:started');
    });

    await expect(a).rejects.toThrow('teardown failed');
    await b;
    expect(order).toEqual(['a:failed', 'b:started']);
  });

  it('replace supersedes an effect that has not started yet', async () => {
    const q = new EffectQueue('replace');
    const order: string[] = [];
    const a = q.push('a', (signal) => {
      order.push('a:started');
      return new Promise<void>((r) => {
        signal.addEventListener('abort', () => {
          setTimeout(() => {
            order.push('a:torn-down');
            r();
          }, 10);
        });
      });
    });
    const b = q.push('b', async () => {
      order.push('b:started');
    });
    const c = q.push('c', async () => {
      order.push('c:started');
    });

    await expect(b).resolves.toBeUndefined();
    await Promise.all([a, c]);

    expect(order).toEqual(['a:started', 'a:torn-down', 'c:started']);
    expect(q.current).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/queue.test.ts`
Expected: FAIL — cannot find module `../src/queue.js`.

- [ ] **Step 3: Implement**

```ts
export const POLICY_NAMES = ['queue', 'replace', 'concurrent'] as const;
export type QueuePolicy = (typeof POLICY_NAMES)[number];
export type EffectRunner = (signal: AbortSignal) => Promise<void>;

interface Entry {
  id: string;
  run: EffectRunner;
  resolve: () => void;
  reject: (e: unknown) => void;
}

interface Slot {
  id: string;
  controller: AbortController;
  settled: Promise<void>;
}

/**
 * Under `replace` the newest push wins outright: it aborts the running effect and drops any
 * effect still waiting, since a `replace` that keeps a backlog is `queue` with an extra abort.
 *
 * Dropping a queued effect resolves rather than rejects — it is done, not failed. A running
 * effect settles however its runner settles, so an abort can still surface as a rejection.
 */
export class EffectQueue {
  private pending: Entry[] = [];
  private live = new Set<Slot>();
  private draining = false;

  constructor(private readonly policy: QueuePolicy = 'queue') {}

  /** The most recently started effect that has not finished; only `concurrent` has more than one. */
  get current(): string | null {
    let latest: string | null = null;
    for (const slot of this.live) latest = slot.id;
    return latest;
  }

  push(id: string, run: EffectRunner): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry: Entry = { id, run, resolve, reject };

      if (this.policy === 'concurrent') {
        void this.start(entry);
        return;
      }
      if (this.policy === 'replace') {
        this.abortLive();
        this.dropPending();
      }

      this.pending.push(entry);
      // Guarding on `live` instead would start a second drain when an effect settles
      // and its own completion handler pushes, running two effects at once.
      if (!this.draining) void this.drain();
    });
  }

  /** Resolves once every aborted effect has finished tearing down, so callers can free what they share. */
  async cancelAll(): Promise<void> {
    this.abortLive();
    this.dropPending();
    await Promise.allSettled([...this.live].map((slot) => slot.settled));
  }

  private abortLive(): void {
    for (const slot of this.live) slot.controller.abort();
  }

  private dropPending(): void {
    const dropped = this.pending;
    this.pending = [];
    for (const entry of dropped) entry.resolve();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      for (let entry = this.pending.shift(); entry; entry = this.pending.shift()) {
        await this.start(entry);
      }
    } finally {
      this.draining = false;
    }
  }

  private start(entry: Entry): Promise<void> {
    const slot: Slot = {
      id: entry.id,
      controller: new AbortController(),
      settled: Promise.resolve(),
    };
    this.live.add(slot);
    // A runner that calls cancelAll from its own synchronous prologue observes the placeholder
    // and is not waited for. Unreachable while every runner awaits something first.
    slot.settled = this.execute(entry, slot);
    return slot.settled;
  }

  private async execute(entry: Entry, slot: Slot): Promise<void> {
    try {
      await entry.run(slot.controller.signal);
      entry.resolve();
    } catch (e) {
      entry.reject(e);
    } finally {
      this.live.delete(slot);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/queue.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/queue.ts packages/core/test/queue.test.ts
git commit -m "add effect queue with queue, replace, and concurrent policies"
```

---

## Task 11: Text layout with kerning

Pure math, no three.js. This is where the opentype.js decision pays off.

**Files:**
- Create: `packages/core/src/text/layout.ts`
- Test: `packages/core/test/text/layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { fitScale, layoutLine } from '../../src/text/layout.js';

// Every glyph is 10 wide; the pair A|V is kerned 3 tighter.
const metrics = {
  advanceOf: (ch: string) => (ch === ' ' ? 5 : 10),
  kernOf: (a: string, b: string) => (a === 'A' && b === 'V' ? -3 : 0),
};

describe('layoutLine', () => {
  it('places glyphs at cumulative advances', () => {
    const line = layoutLine('AB', metrics);
    expect(line.glyphs.map((g) => g.x)).toEqual([0, 10]);
    expect(line.width).toBe(20);
  });

  it('applies kerning between a kerned pair', () => {
    const line = layoutLine('AV', metrics);
    expect(line.glyphs[1]?.x).toBe(7);
    expect(line.width).toBe(17);
  });

  it('keeps spaces as positioned entries so letter indices match the string', () => {
    const line = layoutLine('A B', metrics);
    expect(line.glyphs).toHaveLength(3);
    expect(line.glyphs[1]?.char).toBe(' ');
    expect(line.glyphs[2]?.x).toBe(15);
  });

  it('an empty string has zero width and no glyphs', () => {
    expect(layoutLine('', metrics)).toEqual({ glyphs: [], width: 0 });
  });

  it('width includes the trailing advance, so trailing whitespace must be trimmed by the caller', () => {
    const line = layoutLine('A ', metrics);
    expect(line.glyphs).toHaveLength(2);
    expect(line.width).toBe(15);
  });

  it('treats an astral character as one glyph instead of splitting its surrogate pair', () => {
    const line = layoutLine('A\u{1F600}B', metrics);
    expect(line.glyphs.map((g) => g.char)).toEqual(['A', '\u{1F600}', 'B']);
    expect(line.glyphs.map((g) => g.index)).toEqual([0, 1, 2]);
    expect(line.glyphs[2]?.x).toBe(20);
  });
});

describe('fitScale', () => {
  it('fits to width when the word is wide', () => {
    expect(fitScale(100, 10, { width: 62, height: 100 })).toBeCloseTo(0.62, 5);
  });

  it('fits to height when the word is tall', () => {
    expect(fitScale(10, 100, { width: 100, height: 30 })).toBeCloseTo(0.3, 5);
  });

  it('never scales past the cap', () => {
    expect(fitScale(1, 1, { width: 1000, height: 1000 }, 2.2)).toBe(2.2);
  });

  it('returns the cap for an empty word rather than dividing by zero', () => {
    expect(Number.isFinite(fitScale(0, 0, { width: 10, height: 10 }))).toBe(true);
  });

  it('returns exactly the cap value for a zero-size word, custom cap included', () => {
    expect(fitScale(0, 0, { width: 10, height: 10 })).toBe(2.2);
    expect(fitScale(0, 0, { width: 10, height: 10 }, 5)).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/text/layout.test.ts`
Expected: FAIL — cannot find module `../../src/text/layout.js`.

- [ ] **Step 3: Implement**

```ts
export interface GlyphMetrics {
  advanceOf(char: string): number;
  kernOf(left: string, right: string): number;
}

export interface PlacedGlyph {
  char: string;
  /** Pen x at this glyph's origin, in font units. */
  x: number;
  index: number;
}

export interface Line {
  glyphs: PlacedGlyph[];
  /** Sum of every glyph's advance, including the last — trim trailing whitespace before centering on it. */
  width: number;
}

/** Iterates by Unicode code point, so an astral character (e.g. an emoji) is one glyph, not a split surrogate pair. */
export function layoutLine(text: string, metrics: GlyphMetrics): Line {
  const chars = Array.from(text);
  const glyphs: PlacedGlyph[] = [];
  let pen = 0;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] as string;
    if (i > 0) pen += metrics.kernOf(chars[i - 1] as string, char);
    glyphs.push({ char, x: pen, index: i });
    pen += metrics.advanceOf(char);
  }

  return { glyphs, width: pen };
}

export interface Budget {
  width: number;
  height: number;
}

/**
 * Uniform scale fitting the word inside the budget on both axes. Height matters as much as
 * width: idle rotation swings the word toward the camera, so a width-only fit overflows.
 * An empty word has no ratio to compute, so it falls back to `cap`, the same bound a normal
 * word is clamped to.
 */
export function fitScale(width: number, height: number, budget: Budget, cap = 2.2): number {
  const byWidth = width > 0 ? budget.width / width : Number.POSITIVE_INFINITY;
  const byHeight = height > 0 ? budget.height / height : Number.POSITIVE_INFINITY;
  return Math.min(byWidth, byHeight, cap);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/text/layout.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/layout.ts packages/core/test/text/layout.test.ts
git commit -m "add kerned text layout and two-axis viewport fit"
```

---

## Task 12: Font loading and glyph geometry

**Files:**
- Create: `packages/core/src/text/font.ts`, `packages/core/src/text/glyphs.ts`
- Test: `packages/core/test/text/font.test.ts`, `packages/core/test/text/glyphs.test.ts`

- [ ] **Step 1: Write font.ts**

`@types/opentype.js` declares no default export; the named `parse` import avoids relying on
synthetic default interop.

```ts
import { type Font, parse } from 'opentype.js';
import type { GlyphMetrics } from './layout.js';

export interface LoadedFont {
  font: Font;
  unitsPerEm: number;
  metrics: GlyphMetrics;
}

export async function loadFont(url: string): Promise<LoadedFont> {
  const res = await fetch(url).catch((cause) => {
    throw new Error(`blitsklieg: could not fetch font ${url}`, { cause });
  });
  if (!res.ok) throw new Error(`blitsklieg: failed to load font ${url} (${res.status})`);

  const bytes = await res.arrayBuffer();

  let font: Font;
  try {
    font = parse(bytes);
  } catch (cause) {
    // A server that answers 200 with an HTML error page lands here, not on the status check.
    throw new Error(`blitsklieg: ${url} is not a font opentype.js can parse`, { cause });
  }

  const metrics: GlyphMetrics = {
    advanceOf: (ch) => font.charToGlyph(ch).advanceWidth ?? 0,
    kernOf: (a, b) => font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)),
  };

  return { font, unitsPerEm: font.unitsPerEm, metrics };
}
```

- [ ] **Step 2: Write font.test.ts**

`parse` is mocked so the adapter can be pinned without shipping a font file.

```ts
import type { Font, Glyph } from 'opentype.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

import { loadFont } from '../../src/text/font.js';

function stubFont(glyphs: Record<string, Partial<Glyph>>, kern = 0): Font {
  return {
    unitsPerEm: 1000,
    charToGlyph: (ch: string) => glyphs[ch] ?? {},
    getKerningValue: vi.fn(() => kern),
  } as unknown as Font;
}

function stubFetch(res: Partial<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => res as Response),
  );
}

beforeEach(() => {
  parse.mockReset();
  stubFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
});

describe('loadFont', () => {
  it('names the url and status when the response is not ok', async () => {
    stubFetch({ ok: false, status: 404 });

    await expect(loadFont('/fonts/x.ttf')).rejects.toThrow(
      'blitsklieg: failed to load font /fonts/x.ttf (404)',
    );
  });

  it('names the url when the network call itself rejects', async () => {
    const cause = new TypeError('fetch failed');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(cause)),
    );

    await expect(loadFont('/fonts/x.ttf')).rejects.toMatchObject({
      message: 'blitsklieg: could not fetch font /fonts/x.ttf',
      cause,
    });
  });

  it('does not blame the font file when the body read fails', async () => {
    stubFetch({
      ok: true,
      arrayBuffer: () => Promise.reject(new TypeError('terminated')),
    });

    await expect(loadFont('/fonts/x.ttf')).rejects.toThrow('terminated');
  });

  it('names the url when the bytes are not a parseable font', async () => {
    const cause = new Error('Unsupported OpenType signature 0x3c21444f');
    parse.mockImplementation(() => {
      throw cause;
    });

    await expect(loadFont('/fonts/x.ttf')).rejects.toMatchObject({
      message: 'blitsklieg: /fonts/x.ttf is not a font opentype.js can parse',
      cause,
    });
  });

  it('exposes the parsed font and its em size', async () => {
    const font = stubFont({});
    parse.mockReturnValue(font);

    const loaded = await loadFont('/fonts/x.ttf');
    expect(loaded.font).toBe(font);
    expect(loaded.unitsPerEm).toBe(1000);
  });

  it('reads advances in font units off the glyph', async () => {
    parse.mockReturnValue(stubFont({ A: { advanceWidth: 722 } }));

    const { metrics } = await loadFont('/fonts/x.ttf');
    expect(metrics.advanceOf('A')).toBe(722);
  });

  it('treats a glyph with no advance as zero width', async () => {
    parse.mockReturnValue(stubFont({ A: {} }));

    const { metrics } = await loadFont('/fonts/x.ttf');
    expect(metrics.advanceOf('A')).toBe(0);
  });

  it('kerns by glyph, since opentype takes glyphs rather than characters', async () => {
    const font = stubFont({ A: { index: 1 }, V: { index: 2 } }, -80);
    parse.mockReturnValue(font);

    const { metrics } = await loadFont('/fonts/x.ttf');
    expect(metrics.kernOf('A', 'V')).toBe(-80);
    expect(font.getKerningValue).toHaveBeenCalledWith({ index: 1 }, { index: 2 });
  });
});
```

- [ ] **Step 3: Write the failing test for the glyph cache and contour nesting**

A glyph's counter (the hole in an `O`) is a separate closed contour. `ExtrudeGeometry` only
subtracts contours listed in a `Shape`'s `holes`, so making every contour a top-level `Shape`
renders counters solid. Winding cannot classify them: Skia's `%` ends with two counters whose
outer contours are not the ones immediately preceding them. Nesting depth can.

Two consequences, neither seen in a 60-font sweep. Containment is decided from a single point on
each contour, so a font drawing a stroke as two *overlapping* rather than nested outlines can
misclassify one as a hole. And a contour that never draws is skipped: three closes a contour by
reading its first curve, and containment needs a point to test from, so a malformed glyph would
otherwise throw all the way out and take the overlay with it.

```ts
import type { Font, PathCommand } from 'opentype.js';
import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GLYPH_OPTIONS,
  GlyphCache,
  buildGlyphGeometry,
  glyphToShapes,
} from '../../src/text/glyphs.js';

describe('GlyphCache', () => {
  it('builds a geometry once per distinct key', () => {
    const build = vi.fn((char: string) => ({ char, dispose: vi.fn() }));
    const cache = new GlyphCache(build);

    cache.get('A', 0.3);
    cache.get('A', 0.3);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('treats a different depth as a different geometry', () => {
    const build = vi.fn((char: string) => ({ char, dispose: vi.fn() }));
    const cache = new GlyphCache(build);

    cache.get('A', 0.3);
    cache.get('A', 0.5);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('reuses one geometry across repeated letters in a word', () => {
    const build = vi.fn((char: string) => ({ char, dispose: vi.fn() }));
    const cache = new GlyphCache(build);

    for (const ch of 'BONUS ROUND') cache.get(ch, 0.3);
    expect(build).toHaveBeenCalledTimes(new Set('BONUS ROUND').size);
  });

  it('disposes every cached geometry on dispose and empties itself', () => {
    const made: { dispose: ReturnType<typeof vi.fn> }[] = [];
    const cache = new GlyphCache((char: string) => {
      const g = { char, dispose: vi.fn() };
      made.push(g);
      return g;
    });

    cache.get('A', 0.3);
    cache.get('B', 0.3);
    cache.dispose();

    expect(made).toHaveLength(2);
    for (const g of made) expect(g.dispose).toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });

  it('refuses to build after dispose instead of leaking an unowned geometry', () => {
    const build = vi.fn((char: string) => ({ char, dispose: vi.fn() }));
    const cache = new GlyphCache(build);

    cache.get('A', 0.3);
    cache.dispose();

    expect(() => cache.get('A', 0.3)).toThrow('blitsklieg: GlyphCache used after dispose');
    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });
});

/** A font whose only glyph draws the given commands, so contour nesting is exercised exactly. */
function fontDrawing(commands: PathCommand[]): Font {
  return { charToGlyph: () => ({ getPath: () => ({ commands }) }) } as unknown as Font;
}

function box(x: number, y: number, w: number, h: number): PathCommand[] {
  return [
    { type: 'M', x, y },
    { type: 'L', x: x + w, y },
    { type: 'L', x: x + w, y: y + h },
    { type: 'L', x, y: y + h },
    { type: 'Z' },
  ];
}

/** Enough to catch a curve's bulge; three samples a straight edge at its endpoints regardless. */
const SAMPLES = 16;

/** Extents of a contour's own outline, ignoring any holes hanging off it. */
function topOf(contour: THREE.Path): number {
  return Math.max(...contour.getPoints(SAMPLES).map((p) => p.y));
}

function bottomOf(contour: THREE.Path): number {
  return Math.min(...contour.getPoints(SAMPLES).map((p) => p.y));
}

function leftOf(contour: THREE.Path): number {
  return Math.min(...contour.getPoints(SAMPLES).map((p) => p.x));
}

describe('glyphToShapes', () => {
  it('negates y, because opentype paths are y-down and three is y-up', () => {
    const [shape] = glyphToShapes(fontDrawing(box(0, 0, 10, 10)), 'A', 1);

    expect(topOf(shape as THREE.Shape)).toBe(0);
    expect(bottomOf(shape as THREE.Shape)).toBe(-10);
  });

  it('negates the control point of a quadratic, not just its endpoints', () => {
    const [shape] = glyphToShapes(
      fontDrawing([
        { type: 'M', x: 0, y: 0 },
        { type: 'Q', x1: 5, y1: 10, x: 10, y: 0 },
      ]),
      'o',
      1,
    );

    expect(bottomOf(shape as THREE.Shape)).toBeLessThan(0);
    expect(topOf(shape as THREE.Shape)).toBeLessThanOrEqual(0);
  });

  it('negates both control points of a cubic', () => {
    const [shape] = glyphToShapes(
      fontDrawing([
        { type: 'M', x: 0, y: 0 },
        { type: 'C', x1: 3, y1: 10, x2: 7, y2: 10, x: 10, y: 0 },
      ]),
      'o',
      1,
    );

    expect(bottomOf(shape as THREE.Shape)).toBeLessThan(0);
    expect(topOf(shape as THREE.Shape)).toBeLessThanOrEqual(0);
  });

  it('nests a counter as a hole instead of a second solid shape', () => {
    const shapes = glyphToShapes(fontDrawing([...box(0, 0, 10, 10), ...box(3, 3, 4, 4)]), 'O', 1);

    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.holes).toHaveLength(1);
  });

  it('keeps disjoint contours as separate shapes', () => {
    const shapes = glyphToShapes(fontDrawing([...box(0, 0, 4, 4), ...box(10, 0, 4, 4)]), 'i', 1);

    expect(shapes).toHaveLength(2);
    expect(shapes.every((s) => s.holes.length === 0)).toBe(true);
  });

  it('attaches a counter to the contour containing it, not the one preceding it', () => {
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 10, 10), ...box(20, 0, 10, 10), ...box(3, 3, 4, 4)]),
      '%',
      1,
    );

    expect(shapes).toHaveLength(2);
    const withHole = shapes.filter((s) => s.holes.length > 0);
    expect(withHole).toHaveLength(1);
    expect(topOf(withHole[0] as THREE.Shape)).toBe(0);
    expect(leftOf(withHole[0] as THREE.Shape)).toBe(0);
  });

  it('makes a contour nested two deep solid again', () => {
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 20, 20), ...box(2, 2, 16, 16), ...box(6, 6, 8, 8)]),
      '@',
      1,
    );

    expect(shapes).toHaveLength(2);
  });

  it('gives a hole inside an island to the island, not to the outermost contour', () => {
    // Ordered so that attaching each hole to the most recently opened contour would be wrong.
    const shapes = glyphToShapes(
      fontDrawing([
        ...box(0, 0, 40, 40),
        ...box(10, 10, 20, 20),
        ...box(14, 14, 12, 12),
        ...box(4, 4, 32, 32),
      ]),
      '@',
      1,
    );

    expect(shapes).toHaveLength(2);
    const [outer, island] = [...shapes].sort((a, b) => leftOf(a) - leftOf(b));
    expect(leftOf(outer as THREE.Shape)).toBe(0);
    expect(leftOf(island as THREE.Shape)).toBe(10);
    expect((outer as THREE.Shape).holes.map(leftOf)).toEqual([4]);
    expect((island as THREE.Shape).holes.map(leftOf)).toEqual([14]);
  });

  it('drops a contour with no drawing commands after its move', () => {
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 10, 10), { type: 'M', x: 50, y: 50 }]),
      'A',
      1,
    );

    expect(shapes).toHaveLength(1);
    expect(leftOf(shapes[0] as THREE.Shape)).toBe(0);
  });

  it('skips a contour closed without drawing rather than letting three throw', () => {
    const commands: PathCommand[] = [
      ...box(0, 0, 10, 10),
      { type: 'M', x: 50, y: 50 },
      { type: 'Z' },
    ];

    const shapes = glyphToShapes(fontDrawing(commands), 'A', 1);
    expect(shapes).toHaveLength(1);
    expect(leftOf(shapes[0] as THREE.Shape)).toBe(0);
  });

  it('returns nothing for a glyph with no outline', () => {
    expect(glyphToShapes(fontDrawing([]), ' ', 1)).toEqual([]);
  });
});

describe('buildGlyphGeometry', () => {
  it('computes a bounding box, which callers use to center a word', () => {
    const geo = buildGlyphGeometry(fontDrawing(box(0, 0, 10, 10)), 'A', 1, DEFAULT_GLYPH_OPTIONS);

    expect(geo.boundingBox).not.toBeNull();
    expect(geo.boundingBox?.max.y).toBeGreaterThan(0);
  });

  it('leaves an empty bounding box for a glyph with no outline', () => {
    const geo = buildGlyphGeometry(fontDrawing([]), ' ', 1, DEFAULT_GLYPH_OPTIONS);

    expect(geo.attributes.position?.count).toBe(0);
    expect(geo.boundingBox?.isEmpty()).toBe(true);
    // Callers seeding a running max from 0 absorb this; assigning it straight does not.
    expect(geo.boundingBox?.max.y).toBe(Number.NEGATIVE_INFINITY);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run packages/core/test/text/`
Expected: 2 files FAIL — `font.test.ts` and `glyphs.test.ts` cannot find the modules they import.
`layout.test.ts` shares the directory and already passes.

- [ ] **Step 5: Implement glyphs.ts**

```ts
import type { Font } from 'opentype.js';
import * as THREE from 'three';

export interface GlyphOptions {
  depth: number;
  bevelThickness: number;
  bevelSize: number;
  bevelSegments: number;
  curveSegments: number;
}

export const DEFAULT_GLYPH_OPTIONS: GlyphOptions = {
  depth: 0.3,
  bevelThickness: 0.055,
  bevelSize: 0.038,
  bevelSegments: 5,
  curveSegments: 10,
};

type Buildable = { dispose(): void };

/**
 * Letters repeat heavily, so geometry is built once per (char, depth) and shared. Hold one cache
 * per (font, size, options) — the key discriminates what `build` varies, not what it captures.
 */
export class GlyphCache<T extends Buildable = THREE.ExtrudeGeometry> {
  private cache = new Map<string, T>();
  private disposed = false;

  constructor(private readonly build: (char: string, depth: number) => T) {}

  get size(): number {
    return this.cache.size;
  }

  get(char: string, depth: number): T {
    if (this.disposed) throw new Error('blitsklieg: GlyphCache used after dispose');
    const key = `${char}|${depth}`;
    let g = this.cache.get(key);
    if (!g) {
      g = this.build(char, depth);
      this.cache.set(key, g);
    }
    return g;
  }

  dispose(): void {
    for (const g of this.cache.values()) g.dispose();
    this.cache.clear();
    this.disposed = true;
  }
}

const NESTING_SEGMENTS = 12;

/** opentype.js emits y-down path commands; three is y-up, so every y is negated. */
function contoursOf(font: Font, char: string, size: number): THREE.Shape[] {
  const path = font.charToGlyph(char).getPath(0, 0, size);
  const contours: THREE.Shape[] = [];
  let current: THREE.Shape | null = null;

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
        current = new THREE.Shape();
        current.moveTo(cmd.x, -cmd.y);
        contours.push(current);
        break;
      case 'L':
        current?.lineTo(cmd.x, -cmd.y);
        break;
      case 'Q':
        current?.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y);
        break;
      case 'C':
        current?.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y);
        break;
      case 'Z':
        // three closes a contour by reading its first curve; one that never drew throws.
        if (current?.curves.length) current.closePath();
        break;
    }
  }
  return contours;
}

function containsPoint(polygon: THREE.Vector2[], point: THREE.Vector2): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as THREE.Vector2;
    const b = polygon[j] as THREE.Vector2;
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/**
 * Winding cannot decide this: a font may list a counter after an unrelated contour (Skia's `%`
 * ends with two counters belonging to earlier contours), so nesting depth does it instead.
 */
function nest(contours: THREE.Shape[]): THREE.Shape[] {
  const drawn = contours
    .map((contour) => ({ contour, polygon: contour.getPoints(NESTING_SEGMENTS) }))
    .filter((c) => c.polygon.length >= 3)
    .map((c) => ({ ...c, anchor: c.polygon[0] as THREE.Vector2 }));
  const outlines = drawn.map((o) => ({
    ...o,
    level: drawn.filter((other) => other !== o && containsPoint(other.polygon, o.anchor)).length,
  }));

  const shapes: THREE.Shape[] = [];
  for (const outline of outlines) {
    const container =
      outline.level % 2 === 1
        ? outlines.find(
            (o) => o.level === outline.level - 1 && containsPoint(o.polygon, outline.anchor),
          )
        : undefined;
    if (container) container.contour.holes.push(outline.contour);
    else shapes.push(outline.contour);
  }
  return shapes;
}

export function glyphToShapes(font: Font, char: string, size: number): THREE.Shape[] {
  return nest(contoursOf(font, char, size));
}

export function buildGlyphGeometry(
  font: Font,
  char: string,
  size: number,
  opts: GlyphOptions,
): THREE.ExtrudeGeometry {
  const shapes = glyphToShapes(font, char, size);
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: opts.depth,
    bevelEnabled: true,
    bevelThickness: opts.bevelThickness,
    bevelSize: opts.bevelSize,
    bevelOffset: 0,
    bevelSegments: opts.bevelSegments,
    curveSegments: opts.curveSegments,
  });
  geo.computeBoundingBox();
  return geo;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/text/`
Expected: PASS, 37 tests (11 layout, 8 font, 18 glyphs).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/text/ packages/core/test/text/glyphs.test.ts packages/core/test/text/font.test.ts
git commit -m "add opentype font loading and cached extruded glyph geometry"
```

---

## Task 13: Procedural environment and looks

**Files:**
- Create: `packages/core/src/render/environment.ts`, `packages/core/src/render/looks.ts`
- Test: `packages/core/test/render/looks.test.ts`

- [ ] **Step 1: Write environment.ts**

`buildEnvironment` returns the PMREM render target, not its texture. A render-target texture
never registers three's texture-dispose listener, so `texture.dispose()` frees nothing; only
disposing the target releases the framebuffer and the GL texture.

```ts
import * as THREE from 'three';

interface Bar {
  pos: [number, number, number];
  size: [number, number];
  rot: number;
  rgb: [number, number, number];
}

// RGB values above 1.0 are the point — these are lights, not surfaces.
const BARS: Bar[] = [
  { pos: [-9, 7, -6], size: [26, 2.2], rot: 0.3, rgb: [9, 9, 10] },
  { pos: [11, 4, -4], size: [20, 1.4], rot: -0.22, rgb: [7, 7.6, 9] },
  { pos: [-6, -8, 6], size: [22, 3.0], rot: 0.12, rgb: [2.4, 2.6, 3.4] },
  { pos: [14, -3, 8], size: [14, 5.0], rot: -0.55, rgb: [6, 4.4, 2.2] },
  { pos: [-14, -1, -9], size: [12, 4.0], rot: 0.48, rgb: [2.4, 4.0, 7] },
  { pos: [0, 13, 4], size: [16, 2.0], rot: 0, rgb: [10, 10, 10] },
];

/** Radians of blur applied before prefiltering. */
const BLUR_SIGMA = 0.03;

function buildShell(): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  return new THREE.Mesh(
    new THREE.SphereGeometry(40, 32, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0.05, 0.06, 0.12) },
        bottom: { value: new THREE.Color(0.01, 0.01, 0.02) },
      },
      vertexShader: `
        varying vec3 vP;
        void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
        void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-20.0, 20.0, vP.y)), 1.0); }`,
    }),
  );
}

function buildBar(bar: Bar): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(bar.size[0], bar.size[1]),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(...bar.rgb),
      side: THREE.DoubleSide,
    }),
  );
  mesh.position.set(...bar.pos);
  mesh.lookAt(0, 0, 0);
  mesh.rotateZ(bar.rot);
  return mesh;
}

/**
 * A synthetic photo studio: dark shell plus bright bars, turned into a reflection probe. The
 * render target is returned rather than its texture — disposing a render target's texture frees
 * nothing, so only the caller holding the target can release the GPU memory.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const meshes = [buildShell(), ...BARS.map(buildBar)];
  for (const mesh of meshes) scene.add(mesh);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, BLUR_SIGMA);
  pmrem.dispose();

  for (const mesh of meshes) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  return target;
}
```

- [ ] **Step 2: Write looks.ts**

```ts
import * as THREE from 'three';

export type LookName = 'gold' | 'chrome' | 'oil' | 'ruby';

/** Extract silently drops a name that is not a real material property, so a typo fails DEFAULTS. */
type LookKey = Extract<
  keyof THREE.MeshPhysicalMaterial,
  | 'color'
  | 'metalness'
  | 'roughness'
  | 'clearcoat'
  | 'clearcoatRoughness'
  | 'transmission'
  | 'thickness'
  | 'ior'
  | 'attenuationColor'
  | 'attenuationDistance'
  | 'iridescence'
  | 'iridescenceIOR'
  | 'iridescenceThicknessRange'
>;

export type LookParams = {
  [K in LookKey]: K extends 'iridescenceThicknessRange' ? [number, number] : number;
};

const DEFAULTS: LookParams = {
  color: 0xffffff,
  metalness: 0,
  roughness: 0.2,
  clearcoat: 1,
  clearcoatRoughness: 0.06,
  transmission: 0,
  thickness: 0,
  ior: 1.5,
  attenuationColor: 0xffffff,
  attenuationDistance: Number.POSITIVE_INFINITY,
  iridescence: 0,
  iridescenceIOR: 1.3,
  iridescenceThicknessRange: [100, 400],
};

// Every look is applied over DEFAULTS, never over the previous look, so switching cannot
// leave a stale transmission or iridescence behind.
export const LOOKS: Record<LookName, Partial<LookParams>> = {
  gold: { color: 0xffc44d, metalness: 1, roughness: 0.16, clearcoatRoughness: 0.08 },
  chrome: { color: 0xf2f5fa, metalness: 1, roughness: 0.05, clearcoatRoughness: 0.03 },
  oil: {
    color: 0x0a0a12,
    metalness: 1,
    roughness: 0.12,
    clearcoatRoughness: 0.05,
    // clearcoat sits ABOVE the thin film and flattens it; iridescence needs it off.
    clearcoat: 0,
    iridescence: 1,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [100, 640],
  },
  ruby: {
    color: 0xffffff,
    roughness: 0.06,
    transmission: 1,
    thickness: 1.4,
    ior: 2.2,
    attenuationColor: 0xd4143c,
    attenuationDistance: 0.6,
    clearcoatRoughness: 0.03,
  },
};

export const COLOR_KEYS = new Set<LookKey>(['color', 'attenuationColor']);

export function createMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ envMapIntensity: 2.2 });
}

/**
 * Color-valued params are THREE.Color objects. Assigning a hex number over one replaces the
 * object and the material silently stops working, so they must go through .set().
 */
export function applyLook(material: THREE.MeshPhysicalMaterial, name: LookName): void {
  const params = { ...DEFAULTS, ...LOOKS[name] };
  const target = material as unknown as Record<string, unknown>;

  for (const key of Object.keys(params) as LookKey[]) {
    const value = params[key];
    if (COLOR_KEYS.has(key)) (material[key] as THREE.Color).set(value as number);
    else if (Array.isArray(value)) target[key] = [...value];
    else target[key] = value;
  }
  material.needsUpdate = true;
}
```

- [ ] **Step 3: Write looks.test.ts**

`applyLook` runs headless, so it is tested. `buildEnvironment` needs a real `WebGLRenderer`
and has no test.

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  COLOR_KEYS,
  LOOKS,
  type LookName,
  type LookParams,
  applyLook,
  createMaterial,
} from '../../src/render/looks.js';

const KEY_SET: Record<keyof LookParams, true> = {
  color: true,
  metalness: true,
  roughness: true,
  clearcoat: true,
  clearcoatRoughness: true,
  transmission: true,
  thickness: true,
  ior: true,
  attenuationColor: true,
  attenuationDistance: true,
  iridescence: true,
  iridescenceIOR: true,
  iridescenceThicknessRange: true,
};
const KEYS = Object.keys(KEY_SET) as (keyof LookParams)[];
const NAMES: LookName[] = ['gold', 'chrome', 'oil', 'ruby'];

function snapshot(material: THREE.MeshPhysicalMaterial): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KEYS) {
    const value = material[key];
    out[key] = value instanceof THREE.Color ? value.getHex() : value;
  }
  return out;
}

function withLook(name: LookName): THREE.MeshPhysicalMaterial {
  const material = createMaterial();
  applyLook(material, name);
  return material;
}

describe('createMaterial', () => {
  it('is a physical material with the envMap intensity the looks are tuned against', () => {
    const material = createMaterial();
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material.envMapIntensity).toBe(2.2);
  });
});

describe('LOOKS', () => {
  it('has an entry for every name in the union', () => {
    expect(Object.keys(LOOKS).sort()).toEqual([...NAMES].sort());
  });

  it('turns clearcoat off for oil, since a coat above the thin film flattens it', () => {
    expect(withLook('oil').clearcoat).toBe(0);
    expect(withLook('oil').iridescence).toBe(1);
  });
});

describe('COLOR_KEYS', () => {
  it('names exactly the params three stores as Color objects', () => {
    const fresh = new THREE.MeshPhysicalMaterial();
    const colorValued = KEYS.filter((key) => fresh[key] instanceof THREE.Color);
    expect([...COLOR_KEYS].sort()).toEqual(colorValued.sort());
  });
});

describe('applyLook', () => {
  it('fills unspecified params from the defaults rather than leaving three own values', () => {
    const gold = withLook('gold');
    expect(gold.clearcoat).toBe(1);
    expect(gold.transmission).toBe(0);
    expect(gold.thickness).toBe(0);
    expect(gold.iridescence).toBe(0);
    expect(gold.attenuationDistance).toBe(Number.POSITIVE_INFINITY);
  });

  it.each(NAMES)('%s applied over another look matches a fresh material', (name) => {
    const reused = createMaterial();
    for (const previous of NAMES) applyLook(reused, previous);
    applyLook(reused, name);

    expect(snapshot(reused)).toEqual(snapshot(withLook(name)));
  });

  it('leaves no transmission, thickness or attenuation behind when ruby is replaced', () => {
    const material = withLook('ruby');
    expect(material.transmission).toBe(1);
    expect(material.thickness).toBe(1.4);
    expect(material.attenuationDistance).toBe(0.6);

    applyLook(material, 'gold');
    expect(material.transmission).toBe(0);
    expect(material.thickness).toBe(0);
    expect(material.attenuationDistance).toBe(Number.POSITIVE_INFINITY);
    expect(material.attenuationColor.getHex()).toBe(0xffffff);
  });

  it('leaves no iridescence behind when oil is replaced', () => {
    const material = withLook('oil');
    applyLook(material, 'chrome');
    expect(material.iridescence).toBe(0);
    expect(material.iridescenceIOR).toBe(1.3);
    expect(material.iridescenceThicknessRange).toEqual([100, 400]);
    expect(material.clearcoat).toBe(1);
  });

  it('sets color-valued params through .set(), keeping the Color object', () => {
    const material = withLook('ruby');
    expect(material.color).toBeInstanceOf(THREE.Color);
    expect(material.attenuationColor).toBeInstanceOf(THREE.Color);
    expect(material.color.getHex()).toBe(0xffffff);
    expect(material.attenuationColor.getHex()).toBe(0xd4143c);

    applyLook(material, 'gold');
    expect(material.color).toBeInstanceOf(THREE.Color);
    expect(material.color.getHex()).toBe(0xffc44d);
  });

  it('gives each material its own thickness range instead of sharing the module constant', () => {
    const a = withLook('oil');
    const b = withLook('oil');
    expect(a.iridescenceThicknessRange).toEqual([100, 640]);
    expect(a.iridescenceThicknessRange).not.toBe(b.iridescenceThicknessRange);

    a.iridescenceThicknessRange[1] = 999;
    expect(b.iridescenceThicknessRange[1]).toBe(640);
    expect(withLook('oil').iridescenceThicknessRange[1]).toBe(640);
  });

  it('marks the material for recompile, since transmission and iridescence change the program', () => {
    const material = createMaterial();
    const before = material.version;
    applyLook(material, 'ruby');
    expect(material.version).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: lint and typecheck clean, 141 tests across 13 files (14 new in looks).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/ packages/core/test/render/
git commit -m "add procedural environment map and four material looks"
```

---

## Task 14: Stage — renderer, lifecycle, guardrails

**Files:**
- Create: `packages/core/src/render/stage.ts`
- Create: `packages/core/test/render/stage.test.ts`

- [ ] **Step 1: Implement**

```ts
import * as THREE from 'three';
import { buildEnvironment } from './environment.js';

export interface StageOptions {
  /** Resolved at mount, not at construction, so a document-less environment can still get here. */
  target?: HTMLElement;
  /** Idle milliseconds before the WebGL context is torn down. Browsers cap contexts near 16. */
  idleTimeoutMs: number;
}

export function webglSupported(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    // The probe holds a context until GC otherwise, out of the ~16 the whole design budgets for.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  canvas: HTMLCanvasElement | null = null;
  renderer: THREE.WebGLRenderer | null = null;
  environment: THREE.WebGLRenderTarget | null = null;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private detachResize: (() => void) | null = null;

  constructor(private readonly opts: StageOptions) {
    this.camera.position.set(0, 0, 11);
  }

  /** Idempotent: repeated fires reuse one context rather than allocating a new one. */
  mount(): THREE.WebGLRenderer {
    this.cancelIdle();
    if (this.renderer) return this.renderer;

    const canvas = document.createElement('canvas');
    // Inline because a library ships no stylesheet, and host page CSS must not reach the overlay.
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';

    // premultipliedAlpha:false so a straight-alpha composite does not produce bright halos.
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    (this.opts.target ?? document.body).appendChild(canvas);

    this.canvas = canvas;
    this.renderer = renderer;
    this.environment = buildEnvironment(renderer);
    this.scene.environment = this.environment.texture;

    const onResize = () => this.resize();
    globalThis.addEventListener('resize', onResize);
    this.detachResize = () => globalThis.removeEventListener('resize', onResize);
    this.resize();

    return renderer;
  }

  resize(): void {
    if (!this.renderer) return;
    const w = Math.max(1, globalThis.innerWidth);
    const h = Math.max(1, globalThis.innerHeight);
    // Zoom and a move to another display change devicePixelRatio and fire resize; setPixelRatio
    // reallocates the framebuffer, so only pay for it when the ratio actually moved.
    const ratio = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Visible extent at the word's depth, used by fitScale. */
  viewportBudget(widthFrac = 0.62, heightFrac = 0.3): { width: number; height: number } {
    const vh = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.position.z;
    return { width: vh * this.camera.aspect * widthFrac, height: vh * heightFrac };
  }

  scheduleIdleTeardown(): void {
    this.cancelIdle();
    this.idleTimer = setTimeout(() => this.unmount(), this.opts.idleTimeoutMs);
  }

  private cancelIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  unmount(): void {
    this.cancelIdle();
    const { canvas, renderer, environment, detachResize } = this;
    this.canvas = null;
    this.renderer = null;
    this.environment = null;
    this.detachResize = null;
    this.scene.environment = null;

    try {
      detachResize?.();
      environment?.dispose();
      renderer?.dispose();
    } finally {
      // dispose() drops three's caches but keeps the GL context; only loseContext returns it.
      renderer?.forceContextLoss();
      canvas?.remove();
    }
  }
}
```

- [ ] **Step 2: Test**

Tests run in the `node` environment, so `mount`, `resize` with a live renderer and
`webglSupported`'s success path stay uncovered — faking a DOM or a GL context would only
fake the coverage. `packages/core/test/render/stage.test.ts`:

```ts
import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Stage, prefersReducedMotion, webglSupported } from '../../src/render/stage.js';

/** No DOM here, so every test stays on the paths that never touch `target`. */
function headlessStage(idleTimeoutMs = 1000): Stage {
  return new Stage({ idleTimeoutMs });
}

function frustumHeight(stage: Stage): number {
  return 2 * Math.tan((stage.camera.fov * Math.PI) / 360) * stage.camera.position.z;
}

describe('viewportBudget', () => {
  // 2 * tan(38deg / 2) * 11 = 7.5752075 visible units tall at the word's depth.
  it('matches an extent computed by hand from the constructor fov and distance', () => {
    const stage = headlessStage();

    expect(stage.viewportBudget(1, 1).height).toBeCloseTo(7.5752075, 6);
    expect(stage.viewportBudget().width).toBeCloseTo(4.6966286, 6);
    expect(stage.viewportBudget().height).toBeCloseTo(2.2725622, 6);
  });

  it('matches the frustum extent at the camera distance', () => {
    const stage = headlessStage();
    stage.camera.aspect = 1.5;
    const budget = stage.viewportBudget(1, 1);

    expect(budget.height).toBeCloseTo(frustumHeight(stage), 12);
    expect(budget.width).toBeCloseTo(frustumHeight(stage) * 1.5, 12);
  });

  it('leaves room by default rather than filling the frustum', () => {
    const stage = headlessStage();
    const budget = stage.viewportBudget();

    expect(budget.width).toBeCloseTo(frustumHeight(stage) * stage.camera.aspect * 0.62, 12);
    expect(budget.height).toBeCloseTo(frustumHeight(stage) * 0.3, 12);
  });

  it('feeds aspect into width only', () => {
    const stage = headlessStage();
    stage.camera.aspect = 1;
    const square = stage.viewportBudget();
    stage.camera.aspect = 2;
    const wide = stage.viewportBudget();

    expect(wide.width).toBeCloseTo(square.width * 2, 12);
    expect(wide.height).toBeCloseTo(square.height, 12);
  });

  it('scales linearly with the fractions and with camera distance', () => {
    const stage = headlessStage();
    const half = stage.viewportBudget(0.31, 0.15);
    const full = stage.viewportBudget(0.62, 0.3);

    expect(half.width).toBeCloseTo(full.width / 2, 12);
    expect(half.height).toBeCloseTo(full.height / 2, 12);

    stage.camera.position.z *= 3;
    const far = stage.viewportBudget();
    expect(far.width).toBeCloseTo(full.width * 3, 12);
    expect(far.height).toBeCloseTo(full.height * 3, 12);
  });
});

describe('idle teardown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('unmounts once the idle timeout elapses', () => {
    vi.useFakeTimers();
    const stage = headlessStage(500);
    const unmount = vi.spyOn(stage, 'unmount');

    stage.scheduleIdleTeardown();
    vi.advanceTimersByTime(499);
    expect(unmount).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown instead of stacking timers', () => {
    vi.useFakeTimers();
    const stage = headlessStage(500);
    const unmount = vi.spyOn(stage, 'unmount');

    stage.scheduleIdleTeardown();
    vi.advanceTimersByTime(400);
    stage.scheduleIdleTeardown();
    vi.advanceTimersByTime(400);
    expect(unmount).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(unmount).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending teardown when unmounted early', () => {
    vi.useFakeTimers();
    const stage = headlessStage(500);
    const unmount = vi.spyOn(stage, 'unmount');

    stage.scheduleIdleTeardown();
    stage.unmount();
    vi.advanceTimersByTime(10_000);
    expect(unmount).toHaveBeenCalledTimes(1);
  });
});

describe('unmount', () => {
  it('is safe on a stage that was never mounted, and repeatable', () => {
    const stage = headlessStage();
    expect(() => {
      stage.unmount();
      stage.unmount();
    }).not.toThrow();

    expect(stage.canvas).toBeNull();
    expect(stage.renderer).toBeNull();
    expect(stage.environment).toBeNull();
    expect(stage.scene.environment).toBeNull();
  });

  it('detaches the canvas even when disposal throws, so no context is stranded', () => {
    const stage = headlessStage();
    const remove = vi.fn();
    stage.canvas = { remove } as unknown as HTMLCanvasElement;
    stage.environment = {
      dispose: () => {
        throw new Error('dispose failed');
      },
    } as unknown as THREE.WebGLRenderTarget;

    expect(() => stage.unmount()).toThrow('dispose failed');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(stage.canvas).toBeNull();
    expect(stage.environment).toBeNull();
  });
});

describe('resize', () => {
  it('does nothing without a renderer, so no NaN aspect reaches the camera', () => {
    const stage = headlessStage();
    expect(() => stage.resize()).not.toThrow();
    expect(stage.camera.aspect).toBe(1);
  });
});

describe('webglSupported', () => {
  it('reports false rather than throwing where there is no document', () => {
    expect(webglSupported()).toBe(false);
  });
});

describe('prefersReducedMotion', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'matchMedia');
  });

  it('is false where matchMedia is unavailable', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('asks for the reduce query and returns its match', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    Object.defineProperty(globalThis, 'matchMedia', { value: matchMedia, configurable: true });

    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');

    matchMedia.mockReturnValue({ matches: false });
    expect(prefersReducedMotion()).toBe(false);
  });
});
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: lint and typecheck clean, 155 tests across 14 files (14 new in stage).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/render/stage.ts packages/core/test/render/stage.test.ts
git commit -m "add stage with lazy webgl context, resize, and idle teardown"
```

---

## Task 15: Word — per-letter meshes driven by the timeline

**Files:**
- Create: `packages/core/src/render/word.ts`
- Create: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Implement**

```ts
import * as THREE from 'three';
import type { Timeline } from '../motion/compositor.js';
import type { LoadedFont } from '../text/font.js';
import { DEFAULT_GLYPH_OPTIONS, GlyphCache, buildGlyphGeometry } from '../text/glyphs.js';
import type { Budget } from '../text/layout.js';
import { fitScale, layoutLine } from '../text/layout.js';
import { type LookName, applyLook, createMaterial } from './looks.js';

const EM = 1; // glyphs are built at 1 em; the group scale does the fitting

/** One mesh per letter — per-letter motion (spin, flip, shatter) needs independent transforms. */
export class Word {
  readonly group = new THREE.Group();
  /** null where the glyph drew no outline (space, U+00A0, ZWJ); the slot still holds its index. */
  private readonly letters: (THREE.Mesh | null)[] = [];
  /** Layout x per letter. Pose x is an OFFSET onto this — overwriting it collapses the word. */
  private readonly baseX: number[] = [];
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly cache: GlyphCache;
  private disposed = false;

  constructor(text: string, font: LoadedFont, look: LookName, budget: Budget) {
    this.material = createMaterial();
    applyLook(this.material, look);
    // Enters and exits animate opacity, and flipping this mid-run would recompile the shader.
    this.material.transparent = true;
    this.cache = new GlyphCache((char, depth) =>
      buildGlyphGeometry(font.font, char, EM, { ...DEFAULT_GLYPH_OPTIONS, depth }),
    );

    const scaleToEm = EM / font.unitsPerEm;
    const line = layoutLine(text, font.metrics);

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let inkStart: number | null = null;
    let inkEnd = 0;

    for (const g of line.glyphs) {
      const x = g.x * scaleToEm;
      this.baseX.push(x);

      const geo = this.cache.get(g.char, DEFAULT_GLYPH_OPTIONS.depth);
      if (!geo.attributes.position?.count) {
        this.letters.push(null);
        continue;
      }

      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.x = x;
      this.letters.push(mesh);
      this.group.add(mesh);

      const bounds = geo.boundingBox;
      if (bounds) {
        minY = Math.min(minY, bounds.min.y);
        maxY = Math.max(maxY, bounds.max.y);
      }
      inkStart ??= x;
      inkEnd = x + font.metrics.advanceOf(g.char) * scaleToEm;
    }

    // Spanning the drawn glyphs, not line.width — its trailing advance would push a word ending
    // in whitespace off center.
    const drawn = Number.isFinite(minY);
    const left = inkStart ?? 0;
    // Ink height, not cap height: a descender both drops the center and eats budget.
    const midY = drawn ? (minY + maxY) / 2 : 0;
    const scale = fitScale(inkEnd - left, drawn ? maxY - minY : 0, budget);
    this.group.scale.setScalar(scale);
    // Center on both axes so rotation pivots through the word, not its left edge.
    this.group.position.set((-(left + inkEnd) / 2) * scale, -midY * scale, 0);
  }

  get letterCount(): number {
    return this.letters.length;
  }

  apply(timeline: Timeline, elapsed: number): void {
    if (this.disposed) return;

    let opacity = 0;
    for (let i = 0; i < this.letters.length; i++) {
      const mesh = this.letters[i];
      if (!mesh) continue;

      const pose = timeline.poseAt(elapsed, { index: i, count: this.letters.length });
      mesh.position.x = (this.baseX[i] as number) + pose.position[0];
      mesh.position.y = pose.position[1];
      mesh.position.z = pose.position[2];
      mesh.rotation.set(...pose.rotation);
      mesh.scale.setScalar(pose.scale);
      opacity = Math.max(opacity, pose.opacity);
    }
    // One shared material. A staggered enter (spin, flip, rise) fades letters in at different
    // times, so taking the last letter's opacity would hide the word until it caught up.
    this.material.opacity = opacity;
  }

  dispose(): void {
    this.disposed = true;
    this.cache.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
```

- [ ] **Step 2: Test**

Everything here is CPU-side, so the whole class runs in the `node` environment against a stub
font. `packages/core/test/render/word.test.ts`:

```ts
import type { Font, PathCommand } from 'opentype.js';
import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Timeline } from '../../src/motion/compositor.js';
import { NONE } from '../../src/motion/types.js';
import type { LetterInfo, MotionPiece } from '../../src/motion/types.js';
import type { PoseOffset } from '../../src/pose.js';
import { Word } from '../../src/render/word.js';
import type { LoadedFont } from '../../src/text/font.js';
import type { Budget } from '../../src/text/layout.js';

const UPEM = 1000;
const ADVANCE = 600;
/** One advance in em units — the layout gap between two adjacent letters. */
const STEP = ADVANCE / UPEM;
const NBSP = '\u00a0';
const ZWJ = '\u200d';
const BLANK = new Set([' ', NBSP, ZWJ]);
const DESCENDS = new Set(['g']);

/** Box spanning `bottom`..`top` in three's y-up space; opentype paths are y-down. */
function boxPath(w: number, top: number, bottom: number): PathCommand[] {
  return [
    { type: 'M', x: 0, y: -bottom },
    { type: 'L', x: w, y: -bottom },
    { type: 'L', x: w, y: -top },
    { type: 'L', x: 0, y: -top },
    { type: 'Z' },
  ];
}

/** Chars are 0.5 em wide boxes rising 0.7 em; 'g' also drops 0.2 em, and blanks draw nothing. */
function stubFont(): LoadedFont {
  const font = {
    charToGlyph: (char: string) => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({
        commands: BLANK.has(char)
          ? []
          : boxPath(0.5 * size, 0.7 * size, DESCENDS.has(char) ? -0.2 * size : 0),
      }),
    }),
  } as unknown as Font;

  return {
    font,
    unitsPerEm: UPEM,
    metrics: { advanceOf: () => ADVANCE, kernOf: () => 0 },
  };
}

const ROOMY: Budget = { width: 100, height: 100 };

function timelineOf(offset: MotionPiece['offset']): Timeline {
  return new Timeline({
    enter: { duration: 100, offset },
    active: NONE,
    exit: NONE,
    hold: 0,
    blendMs: 0,
  });
}

function meshes(word: Word): THREE.Mesh[] {
  return word.group.children as THREE.Mesh[];
}

function materialOf(word: Word): THREE.MeshPhysicalMaterial {
  return (meshes(word)[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
}

/** World-space midpoint of the advance span the drawn glyphs occupy. */
function inkCenter(word: Word): number {
  const drawn = meshes(word);
  const first = drawn[0] as THREE.Mesh;
  const last = drawn[drawn.length - 1] as THREE.Mesh;
  const span = (first.position.x + last.position.x + STEP) / 2;
  return word.group.position.x + word.group.scale.x * span;
}

/** Vertical extent the drawn glyphs cover, in group-local units. */
function inkSpanY(word: Word): { min: number; max: number } {
  const boxes = meshes(word).map((m) => m.geometry.boundingBox as THREE.Box3);
  return {
    min: Math.min(...boxes.map((b) => b.min.y)),
    max: Math.max(...boxes.map((b) => b.max.y)),
  };
}

/** World-space vertical midpoint of that ink, before any pose is applied. */
function inkCenterY(word: Word): number {
  const { min, max } = inkSpanY(word);
  return word.group.position.y + word.group.scale.x * ((min + max) / 2);
}

describe('Word', () => {
  it('gives every code point a slot but only the drawn glyphs a mesh', () => {
    const word = new Word('A B', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(3);
    expect(meshes(word)).toHaveLength(2);
  });

  it('treats any outline-less glyph as blank, not just the space character', () => {
    const word = new Word(`A${NBSP}B${ZWJ}C`, stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(5);
    expect(meshes(word)).toHaveLength(3);
  });

  it('shares one cached geometry across repeated letters', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const [a, b] = meshes(word);

    expect(a?.geometry).toBe(b?.geometry);
  });

  it('lays letters out one advance apart', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const [a, b] = meshes(word);

    expect((b?.position.x ?? 0) - (a?.position.x ?? 0)).toBeCloseTo(STEP, 10);
  });

  it('adds pose x onto the layout x instead of replacing it', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf(() => ({ position: [1, 0, 0] })),
      50,
    );
    const [a, b] = meshes(word);

    expect(a?.position.x).toBeCloseTo(1, 10);
    expect(b?.position.x).toBeCloseTo(1 + STEP, 10);
  });

  it('takes pose y, z, rotation and scale absolutely', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf(() => ({ position: [0, 2, 3], rotation: [0.1, 0.2, 0.3], scale: 4 })),
      50,
    );
    const [a] = meshes(word);

    expect(a?.position.y).toBeCloseTo(2, 10);
    expect(a?.position.z).toBeCloseTo(3, 10);
    expect([a?.rotation.x, a?.rotation.y, a?.rotation.z]).toEqual([0.1, 0.2, 0.3]);
    expect(a?.scale.x).toBeCloseTo(4, 10);
  });

  it('hands the timeline each letter index including the blanks it skips', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('A B', stubFont(), 'gold', ROOMY);

    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      50,
    );

    expect(seen).toEqual([
      { index: 0, count: 3 },
      { index: 2, count: 3 },
    ]);
  });

  it('centers the word on both axes', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);

    expect(inkCenter(word)).toBeCloseTo(0, 10);
    expect(inkCenterY(word)).toBeCloseTo(0, 10);
  });

  it('centers on the ink, so a descender is not left hanging below the frame', () => {
    const font = stubFont();
    const plain = new Word('AA', font, 'gold', ROOMY);
    const dropped = new Word('Ag', font, 'gold', ROOMY);

    expect(inkCenterY(dropped)).toBeCloseTo(0, 10);
    // Cap-height centering would put both at the same y; a lower ink center has to raise the group.
    expect(dropped.group.position.y).toBeGreaterThan(plain.group.position.y);
  });

  it('fits the ink height, descender included, rather than the cap height', () => {
    const font = stubFont();
    const loose = new Word('g', font, 'gold', ROOMY);
    const { min, max } = inkSpanY(loose);

    const fitted = new Word('g', font, 'gold', { width: 100, height: (max - min) / 2 });

    expect(fitted.group.scale.x).toBeCloseTo(0.5, 10);
  });

  it('centers on the drawn glyphs, so surrounding whitespace does not shift the word', () => {
    const font = stubFont();
    const plain = new Word('AA', font, 'gold', ROOMY);
    const trailing = new Word('AA  ', font, 'gold', ROOMY);
    const leading = new Word('  AA', font, 'gold', ROOMY);

    expect(inkCenter(trailing)).toBeCloseTo(0, 10);
    expect(inkCenter(leading)).toBeCloseTo(0, 10);
    expect(trailing.group.scale.x).toBeCloseTo(plain.group.scale.x, 10);
    expect(leading.group.scale.x).toBeCloseTo(plain.group.scale.x, 10);
  });

  it('scales the word down to the budget it is given', () => {
    // Two letters span two advances, so a budget of one advance has to halve them.
    const word = new Word('AA', stubFont(), 'gold', { width: STEP, height: 100 });

    expect(word.group.scale.x).toBeCloseTo(0.5, 10);
    expect(inkCenter(word)).toBeCloseTo(0, 10);
  });

  it('falls back to the fit cap for a word with nothing to draw', () => {
    const word = new Word('  ', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(2);
    expect(meshes(word)).toHaveLength(0);
    expect(word.group.scale.x).toBe(2.2);
    expect(word.group.position.x).toBeCloseTo(0, 10);
  });

  it('renders through the transparent path so an exit can fade', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);

    expect(materialOf(word).transparent).toBe(true);
  });

  it('wears the most visible letter opacity, not the last letter to be posed', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const fadeByIndex = (_t: number, letter: LetterInfo): PoseOffset => ({
      opacity: letter.index === 0 ? 1 : 0,
    });

    word.apply(timelineOf(fadeByIndex), 50);

    expect(materialOf(word).opacity).toBe(1);
  });

  it('applies the look to the shared material', () => {
    const word = new Word('A', stubFont(), 'chrome', ROOMY);

    expect(materialOf(word).metalness).toBe(1);
    expect(materialOf(word).roughness).toBeCloseTo(0.05, 10);
  });

  it('disposes the glyph geometry and the material, and empties the group', () => {
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    const [a, b] = meshes(word);
    const geoA = vi.spyOn(a?.geometry as THREE.BufferGeometry, 'dispose');
    const geoB = vi.spyOn(b?.geometry as THREE.BufferGeometry, 'dispose');
    const material = vi.spyOn(materialOf(word), 'dispose');

    word.dispose();

    expect(geoA).toHaveBeenCalled();
    expect(geoB).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
    expect(word.group.children).toHaveLength(0);
  });

  it('goes inert after dispose rather than posing into a disposed material', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    const [a] = meshes(word);
    const material = materialOf(word);

    word.dispose();
    word.apply(
      timelineOf(() => ({ position: [5, 0, 0], opacity: 0.25 })),
      50,
    );

    expect(a?.position.x).toBe(0);
    expect(material.opacity).toBe(1);
  });
});
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: lint and typecheck clean, 173 tests across 15 files (18 new in word).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "add word with per-letter meshes driven by the timeline"
```

---

## Task 16: Public surface

**Files:**
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/index.test.ts`

**Publishing note (do not skip):** `packages/core/tsconfig.json` uses `rootDir: "."` with
`include: ["src", "test"]`, so emit lands at `dist/src/index.d.ts` — **not** `dist/index.d.ts`,
and `dist/test/` gets built too. If this task adds a `types` field, it must point at
`./dist/src/index.d.ts`, or the tsconfig must first be split into a `src`-only project plus a
`tsconfig.test.json` that references it. Writing the obvious-looking `./dist/index.d.ts` yields a
path that does not exist.

Packaging (`private`, `exports`, `types`, `files`) is not part of this task despite Task 1's
note: `apps/lab` resolves `main` straight to TypeScript and Vite compiles it.

- [ ] **Step 1: Implement**

```ts
import { type Clock, RafClock } from './clock.js';
import { ACTIVE, ENV_DRIVEN } from './motion/active.js';
import { Timeline } from './motion/compositor.js';
import { ENTER } from './motion/enter.js';
import { EXIT } from './motion/exit.js';
import type { ActiveName, EnterName, ExitName } from './motion/types.js';
import { EffectQueue, type QueuePolicy } from './queue.js';
import { LOOKS, type LookName } from './render/looks.js';
import { Stage, prefersReducedMotion, webglSupported } from './render/stage.js';
import { Word } from './render/word.js';
import { type LoadedFont, loadFont } from './text/font.js';

export type { EnterName, ActiveName, ExitName, LookName, QueuePolicy, Clock };
export { ManualClock } from './clock.js';
export { POLICY_NAMES } from './queue.js';

// Read off the records the effect itself indexes. Those are typed exhaustive over the unions,
// so a name cannot be added, renamed or dropped without these lists following it.
export const ENTER_NAMES: readonly EnterName[] = Object.keys(ENTER) as EnterName[];
export const ACTIVE_NAMES: readonly ActiveName[] = Object.keys(ACTIVE) as ActiveName[];
export const EXIT_NAMES: readonly ExitName[] = Object.keys(EXIT) as ExitName[];
export const LOOK_NAMES: readonly LookName[] = Object.keys(LOOKS) as LookName[];

const TAU = Math.PI * 2;

export interface BlitskliegOptions {
  target?: HTMLElement;
  fontUrl: string;
  clock?: Clock;
  /**
   * `concurrent` is unsound for `sweep`: every live effect writes the shared environment
   * rotation from its own elapsed time, so the highlight sawtooths between their phases.
   */
  policy?: QueuePolicy;
  idleTimeoutMs?: number;
}

/** Closed union so element-anchoring can arrive in v1.2 without an API break. */
export type Placement = { kind: 'fullscreen' };

export interface FireOptions {
  enter?: EnterName;
  active?: ActiveName;
  exit?: ExitName;
  look?: LookName;
  hold?: number;
  bloom?: boolean;
  blendMs?: number;
  placement?: Placement;
}

export interface Blitsklieg {
  readonly supported: boolean;
  /** Resolves when the effect leaves the screen, whether it played out or was cancelled. */
  fire(text: string, options?: FireOptions): Promise<void>;
  /** Cancels everything in flight; the stage comes down once the running effect has settled. */
  destroy(): void;
}

export function createBlitsklieg(options: BlitskliegOptions): Blitsklieg {
  const supported = webglSupported();
  const clock = options.clock ?? new RafClock();
  const queue = new EffectQueue(options.policy ?? 'queue');
  const stage = new Stage({
    target: options.target,
    idleTimeoutMs: options.idleTimeoutMs ?? 8000,
  });

  let fontPromise: Promise<LoadedFont> | null = null;
  function font(): Promise<LoadedFont> {
    if (fontPromise) return fontPromise;
    // Memoizing the rejection too would make one failed fetch permanent for this instance.
    fontPromise = loadFont(options.fontUrl).catch((err) => {
      fontPromise = null;
      throw err;
    });
    return fontPromise;
  }

  async function run(text: string, opts: FireOptions, signal: AbortSignal): Promise<void> {
    const loaded = await font();
    if (signal.aborted) return;

    const renderer = stage.mount();
    const word = new Word(text, loaded, opts.look ?? 'gold', stage.viewportBudget());
    stage.scene.add(word.group);

    const enter = ENTER[opts.enter ?? 'slam'];
    const activeName = opts.active ?? 'sweep';
    const hold = opts.hold ?? 1200;
    const timeline = new Timeline({
      enter,
      active: ACTIVE[activeName],
      exit: EXIT[opts.exit ?? 'fade'],
      hold,
      blendMs: opts.blendMs ?? 120,
    });

    // Reduced motion: hold the pose the enter settles into for `hold`, then leave. No travel.
    const still = prefersReducedMotion();
    const startedAt = clock.now();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        off();
        stage.scene.remove(word.group);
        word.dispose();
        stage.scheduleIdleTeardown();
        done();
      };
      const finish = () => settle(resolve);

      const off = clock.subscribe((now) => {
        if (signal.aborted) return finish();

        try {
          // rAF reports the frame's start time, which can precede a now() sampled moments earlier.
          const since = now - startedAt;
          const elapsed = Math.min(Math.max(still ? enter.duration : since, 0), timeline.duration);
          word.apply(timeline, elapsed);

          // Effect-relative and zeroed off-sweep: absolute clock time would start every sweep at
          // an arbitrary angle and leave the last one's angle behind on the next effect.
          stage.scene.environmentRotation.y = ENV_DRIVEN.has(activeName)
            ? (elapsed / ACTIVE[activeName].duration) * TAU
            : 0;

          renderer.setRenderTarget(null);
          renderer.clear();
          renderer.render(stage.scene, stage.camera);

          if (still ? since >= hold : timeline.isFinished(since)) finish();
        } catch (err) {
          // RafClock keeps a throwing subscriber subscribed, so a lost context would otherwise
          // throw every frame forever with the word still on a stage destroy() can never settle.
          settle(() => reject(err));
        }
      });

      // Teardown must not wait for a tick: rAF stops in a hidden tab, and destroy() holds a
      // scarce GL context until this effect settles.
      signal.addEventListener('abort', finish);
      if (signal.aborted) finish();
    });
  }

  let counter = 0;
  let destroyed = false;

  return {
    supported,
    fire(text, opts = {}) {
      if (!supported || destroyed) return Promise.resolve();
      return queue.push(`${counter++}:${text}`, (signal) => run(text, opts, signal));
    },
    destroy() {
      destroyed = true;
      // A running effect only notices the abort on its next tick, and tearing down first would
      // leave it re-arming idle teardown against a stage that is already gone.
      void queue.cancelAll().then(() => stage.unmount());
    },
  };
}
```

- [ ] **Step 2: Test**

```ts
import type { Font } from 'opentype.js';
import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Clock, ManualClock, type Tick } from '../src/clock.js';
import {
  ACTIVE_NAMES,
  type BlitskliegOptions,
  ENTER_NAMES,
  EXIT_NAMES,
  LOOK_NAMES,
  POLICY_NAMES,
  createBlitsklieg,
} from '../src/index.js';
import { Stage } from '../src/render/stage.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

const UPEM = 1000;
const ADVANCE = 600;
const TAU = Math.PI * 2;
/** Every letter is a 0.5 em box, so each one gets a real mesh. */
const BOX = (size: number) => [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 0.5 * size, y: 0 },
  { type: 'L', x: 0.5 * size, y: -0.7 * size },
  { type: 'Z' },
];

function stubFont(): Font {
  return {
    unitsPerEm: UPEM,
    charToGlyph: () => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({ commands: BOX(size) }),
    }),
    getKerningValue: () => 0,
  } as unknown as Font;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Ignores unsubscribe, so a tick still reaches an effect that has already settled. */
class LeakyClock implements Clock {
  private t = 0;
  private readonly subs = new Set<Tick>();

  now(): number {
    return this.t;
  }

  subscribe(fn: Tick): () => void {
    this.subs.add(fn);
    return () => {};
  }

  advance(deltaMs: number): void {
    this.t += deltaMs;
    for (const fn of [...this.subs]) fn(this.t);
  }
}

let clock: ManualClock;
let calls: string[];
let mounted: Stage | null;
let renderer: THREE.WebGLRenderer;
let renders: number;
let peakWords: number;
/** Hook for the one test that needs a tick to blow up the way a lost context does. */
let onRender: () => void;

function stubStage(): void {
  vi.spyOn(Stage.prototype, 'mount').mockImplementation(function (this: Stage) {
    mounted = this;
    calls.push('mount');
    return renderer;
  });
  vi.spyOn(Stage.prototype, 'scheduleIdleTeardown').mockImplementation(() => {
    calls.push('idle');
  });
  vi.spyOn(Stage.prototype, 'unmount').mockImplementation(() => {
    calls.push('unmount');
  });
}

/** All webglSupported() probes for; every other GL path is stubbed at Stage.mount. */
function stubWebgl(available: boolean): void {
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => (available ? { getExtension: () => null } : null) }),
  });
}

function stubFetch(
  res: Partial<Response> = { ok: true, arrayBuffer: async () => new ArrayBuffer(8) },
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => res as Response),
  );
}

function create(opts: Partial<BlitskliegOptions> = {}) {
  // `target` is never read: Stage.mount is the only thing that appends to it.
  return createBlitsklieg({ fontUrl: '/f.ttf', clock, target: {} as HTMLElement, ...opts });
}

function stage(): Stage {
  if (!mounted) throw new Error('the stage was never mounted');
  return mounted;
}

function words(): THREE.Object3D[] {
  return stage().scene.children;
}

function firstMesh(): THREE.Mesh {
  const group = words()[0] as THREE.Group;
  return group.children[0] as THREE.Mesh;
}

beforeEach(() => {
  clock = new ManualClock();
  calls = [];
  mounted = null;
  renders = 0;
  peakWords = 0;
  onRender = () => {};
  renderer = {
    setRenderTarget: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(() => {
      renders++;
      peakWords = Math.max(peakWords, words().length);
      onRender();
    }),
  } as unknown as THREE.WebGLRenderer;

  parse.mockReturnValue(stubFont());
  stubFetch();
  stubWebgl(true);
  stubStage();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Enter, active and exit all zero-length, so the effect finishes on its first tick. */
const INSTANT = { enter: 'none', active: 'none', exit: 'none', hold: 0 } as const;

describe('createBlitsklieg', () => {
  it('mounts, renders and tears the word down when the timeline finishes', async () => {
    const bk = create();
    expect(bk.supported).toBe(true);

    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;

    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(1);
    expect(words()).toHaveLength(0);
  });

  it('reports unsupported and touches neither the stage nor the font', async () => {
    stubWebgl(false);
    const bk = create();

    expect(bk.supported).toBe(false);
    await bk.fire('HELLO');

    expect(calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('constructs and degrades with no document at all', async () => {
    // Not stubWebgl(false): that leaves a document in place, which is the one thing an SSR
    // render does not have, and `supported` exists to survive.
    vi.unstubAllGlobals();
    const bk = createBlitsklieg({ fontUrl: '/f.ttf', clock });

    expect(bk.supported).toBe(false);
    await bk.fire('HELLO');

    expect(calls).toEqual([]);
  });

  it('ignores fire after destroy', async () => {
    const bk = create();
    bk.destroy();

    await bk.fire('HELLO');
    await flush();

    expect(calls).toEqual(['unmount']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('tears the running effect down on abort rather than on the next tick', async () => {
    const bk = create();
    const done = bk.fire('HELLO', { hold: 5000 });
    await flush();
    clock.advance(16);
    expect(calls).toEqual(['mount']);

    bk.destroy();
    await done;
    await flush();

    // No further advance: a hidden tab stops ticking, and destroy() cannot wait for one.
    expect(calls).toEqual(['mount', 'idle', 'unmount']);
    expect(words()).toHaveLength(0);
  });

  it('ignores a tick that arrives after the effect has settled', async () => {
    const leaky = new LeakyClock();
    const bk = create({ clock: leaky });
    const done = bk.fire('HELLO', { hold: 5000 });
    await flush();
    leaky.advance(16);

    bk.destroy();
    await done;
    await flush();
    expect(calls).toEqual(['mount', 'idle', 'unmount']);

    leaky.advance(16);
    expect(calls).toEqual(['mount', 'idle', 'unmount']);
    expect(renders).toBe(1);
  });

  it('unmounts only once a cancelled effect has settled', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }),
    );

    const bk = create();
    const done = bk.fire('HELLO', INSTANT).then(() => calls.push('settled'));
    await flush();
    bk.destroy();
    await flush();
    expect(calls).toEqual([]);

    release();
    await done;
    await flush();
    expect(calls).toEqual(['settled', 'unmount']);
  });

  it('rejects the effect and comes down when a tick throws', async () => {
    const bk = create();
    onRender = () => {
      throw new Error('context lost');
    };
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);

    await expect(done).rejects.toThrow('context lost');
    expect(calls).toEqual(['mount', 'idle']);
    expect(words()).toHaveLength(0);

    // The subscriber is gone, so the throw does not repeat every frame.
    clock.advance(16);
    expect(renders).toBe(1);

    bk.destroy();
    await flush();
    expect(calls).toEqual(['mount', 'idle', 'unmount']);
  });

  it('passes the queue policy through', async () => {
    const bk = create({ policy: 'replace' });
    const first = bk.fire('A', INSTANT);
    const second = bk.fire('B', INSTANT);

    await flush();
    clock.advance(16);
    await first;
    await flush();
    clock.advance(16);
    await second;

    // Under the default `queue` policy both words would play, in turn.
    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(1);
  });

  it('runs queued effects one at a time', async () => {
    const bk = create();
    const a = bk.fire('A', { ...INSTANT, hold: 32 });
    const b = bk.fire('B', INSTANT);

    await flush();
    clock.advance(32);
    await a;
    await flush();
    clock.advance(16);
    await b;

    expect(calls).toEqual(['mount', 'idle', 'mount', 'idle']);
    expect(peakWords).toBe(1);
  });

  it('surfaces a font failure and still loads the font on the next fire', async () => {
    stubFetch({ ok: false, status: 404 });
    const bk = create();

    await expect(bk.fire('HI', INSTANT)).rejects.toThrow('blitsklieg: failed to load font');

    stubFetch();
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;

    expect(calls).toEqual(['mount', 'idle']);
  });

  it('holds the pose the enter settles into under reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const bk = create();
    const done = bk.fire('HI', { enter: 'slam', active: 'sweep', exit: 'fade', hold: 100 });

    await flush();
    clock.advance(16);
    const mesh = firstMesh();
    const material = mesh.material as THREE.MeshPhysicalMaterial;

    // The end of the exit would leave a faded-out word on screen for the whole hold.
    expect(material.opacity).toBeCloseTo(1, 6);
    expect(mesh.position.z).toBeCloseTo(0, 6);
    expect(mesh.scale.x).toBeCloseTo(1, 6);

    clock.advance(100);
    await done;
    expect(calls).toEqual(['mount', 'idle']);
  });

  it('turns the environment once per sweep pass', async () => {
    const bk = create();
    const done = bk.fire('HI', { ...INSTANT, active: 'sweep', hold: 3400 });

    await flush();
    clock.advance(850);
    expect(stage().scene.environmentRotation.y).toBeCloseTo(TAU / 4, 6);

    clock.advance(2550);
    await done;
  });

  it('restarts the sweep per effect and zeroes the environment for pieces that do not drive it', async () => {
    const bk = create();
    const first = bk.fire('HI', { ...INSTANT, active: 'sweep', hold: 1700 });
    await flush();
    clock.advance(1700);
    await first;

    const second = bk.fire('HI', { ...INSTANT, active: 'sweep', hold: 16 });
    await flush();
    clock.advance(16);
    // Absolute clock time would land near TAU / 2 here, wherever the last effect left off.
    expect(stage().scene.environmentRotation.y).toBeCloseTo((16 / 3400) * TAU, 6);
    await second;

    const third = bk.fire('HI', { ...INSTANT, active: 'float' });
    await flush();
    clock.advance(16);
    await third;
    expect(stage().scene.environmentRotation.y).toBe(0);
  });
});

describe('published name lists', () => {
  // Literal rather than derived: the arrays are already exhaustive by construction, so what is
  // left to pin is the order a picker shows and the fact that dropping one is a breaking change.
  it('lists every name a consumer can fire with, motion-first', () => {
    expect(ENTER_NAMES).toEqual(['slam', 'spin', 'flip', 'assemble', 'rise', 'none']);
    expect(ACTIVE_NAMES).toEqual(['sweep', 'float', 'pulse', 'shimmer', 'none']);
    expect(EXIT_NAMES).toEqual(['shatter', 'drop', 'recede', 'fade', 'none']);
    expect(LOOK_NAMES).toEqual(['gold', 'chrome', 'oil', 'ruby']);
    expect(POLICY_NAMES).toEqual(['queue', 'replace', 'concurrent']);
  });
});
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: lint and typecheck clean, 188 tests across 16 files (15 new in index).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "add public createBlitsklieg surface wiring stage, timeline, and queue"
```

---

## Task 17: Bloom path

**Files:**
- Create: `packages/core/src/render/bloom.ts`
- Create: `packages/core/test/render/bloom.test.ts`
- Modify: `packages/core/src/index.ts` — select the path from `opts.bloom`
- Modify: `packages/core/test/index.test.ts` — the wiring, and disposal on every path out

The overlay is transparent, so a glow written where the scene's alpha is 0 is dropped by the
page compositor: the composite gives the glow alpha of its own. It also applies the output
color space encode, which three performs only for shaders that include `<colorspace_fragment>`
— the word renders into a linear target here rather than straight to the canvas.

`Stage.resize()` owns the canvas size and knows nothing about these targets, so `render()`
reallocates them whenever the drawing buffer has moved.

`FireOptions.bloom` stays a boolean; `BloomOptions` is not part of the public surface.

- [ ] **Step 1: Implement bloom.ts**

```ts
import * as THREE from 'three';

const QUAD_VS = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export interface BloomOptions {
  strength: number;
  threshold: number;
  alphaBoost: number;
}

export const DEFAULT_BLOOM: BloomOptions = { strength: 1.1, threshold: 0.72, alphaBoost: 0.9 };

type Sampler = THREE.IUniform<THREE.Texture | null>;

/** Half-res texels per tap, one separable pass each: a tight core under a wider halo. */
const BLUR_RADII = [1, 2.5];

export class BloomPath {
  private sceneRT!: THREE.WebGLRenderTarget;
  private brightRT!: THREE.WebGLRenderTarget;
  private blurRT!: THREE.WebGLRenderTarget;

  private readonly allocated = new THREE.Vector2();
  private readonly drawingBuffer = new THREE.Vector2();

  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.Camera();
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));

  private readonly thresholdMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;

  private readonly thresholdSrc: Sampler = { value: null };
  private readonly blurSrc: Sampler = { value: null };
  private readonly blurDir: THREE.IUniform<THREE.Vector2> = { value: new THREE.Vector2() };
  private readonly compositeBase: Sampler = { value: null };
  private readonly compositeBloom: Sampler = { value: null };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    opts = DEFAULT_BLOOM,
  ) {
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const common = { depthTest: false, depthWrite: false, blending: THREE.NoBlending };

    this.thresholdMat = new THREE.ShaderMaterial({
      ...common,
      uniforms: { tDiffuse: this.thresholdSrc, threshold: { value: opts.threshold } },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(c.rgb * smoothstep(threshold, threshold + 0.35, l) * c.a, 1.0);
        }`,
    });

    this.blurMat = new THREE.ShaderMaterial({
      ...common,
      uniforms: { tDiffuse: this.blurSrc, dir: this.blurDir },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
        void main(){
          vec4 s = vec4(0.0);
          s += texture2D(tDiffuse, vUv + dir * -4.0) * 0.0162;
          s += texture2D(tDiffuse, vUv + dir * -3.0) * 0.0540;
          s += texture2D(tDiffuse, vUv + dir * -2.0) * 0.1216;
          s += texture2D(tDiffuse, vUv + dir * -1.0) * 0.1946;
          s += texture2D(tDiffuse, vUv)              * 0.2270;
          s += texture2D(tDiffuse, vUv + dir *  1.0) * 0.1946;
          s += texture2D(tDiffuse, vUv + dir *  2.0) * 0.1216;
          s += texture2D(tDiffuse, vUv + dir *  3.0) * 0.0540;
          s += texture2D(tDiffuse, vUv + dir *  4.0) * 0.0162;
          gl_FragColor = s;
        }`,
    });

    this.compositeMat = new THREE.ShaderMaterial({
      ...common,
      transparent: true,
      uniforms: {
        tBase: this.compositeBase,
        tBloom: this.compositeBloom,
        strength: { value: opts.strength },
        alphaBoost: { value: opts.alphaBoost },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tBase, tBloom;
        uniform float strength, alphaBoost;
        varying vec2 vUv;
        void main(){
          vec4 base  = texture2D(tBase,  vUv);
          vec3 bloom = texture2D(tBloom, vUv).rgb * strength;
          // The glow lives outside the letters' silhouette where base.a is 0. Without giving
          // it alpha of its own it renders into a transparent region and is never seen.
          float bl = dot(bloom, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(base.rgb + bloom, clamp(max(base.a, bl * alphaBoost), 0.0, 1.0));
          // three encodes for the canvas only through this include, and the scene target is linear.
          #include <colorspace_fragment>
        }`,
    });

    this.resize();
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    this.resize();

    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    this.thresholdSrc.value = this.sceneRT.texture;
    this.blit(this.thresholdMat, this.brightRT);

    for (const radius of BLUR_RADII) {
      this.blurSrc.value = this.brightRT.texture;
      this.blurDir.value.set(radius / this.brightRT.width, 0);
      this.blit(this.blurMat, this.blurRT);
      this.blurSrc.value = this.blurRT.texture;
      this.blurDir.value.set(0, radius / this.brightRT.height);
      this.blit(this.blurMat, this.brightRT);
    }

    this.compositeBase.value = this.sceneRT.texture;
    this.compositeBloom.value = this.brightRT.texture;
    this.blit(this.compositeMat, null);
  }

  /** Per frame because the stage resizes the drawing buffer without knowing these targets exist. */
  private resize(): void {
    const size = this.renderer.getDrawingBufferSize(this.drawingBuffer);
    const w = Math.max(2, size.x);
    const h = Math.max(2, size.y);
    if (this.allocated.x === w && this.allocated.y === h) return;
    this.allocated.set(w, h);

    const opts = {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    } as const;

    this.sceneRT?.dispose();
    this.brightRT?.dispose();
    this.blurRT?.dispose();

    // samples>0 is the ONLY thing that antialiases a render target. The renderer's
    // `antialias: true` applies to the default framebuffer and is ignored here.
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { ...opts, depthBuffer: true, samples: 4 });
    this.brightRT = new THREE.WebGLRenderTarget(w >> 1, h >> 1, opts);
    this.blurRT = new THREE.WebGLRenderTarget(w >> 1, h >> 1, opts);
  }

  private blit(material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    // Redundant while autoClear is on and the quad covers every pixel; keep it as the insurance.
    this.renderer.clear();
    this.renderer.render(this.quadScene, this.quadCam);
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.brightRT.dispose();
    this.blurRT.dispose();
    this.quad.geometry.dispose();
    this.thresholdMat.dispose();
    this.blurMat.dispose();
    this.compositeMat.dispose();
  }
}
```

- [ ] **Step 2: Wire it into index.ts**

Add the import:

```ts
import { BloomPath } from './render/bloom.js';
```

Create the path just after `const renderer = stage.mount();`, and guard the `Word` that
follows it — a throw there rejects `run()` before the promise owning `settle()` exists, and
the bloom at that point is either `null` or fully disposable:

```ts
    const bloom = opts.bloom ? new BloomPath(renderer) : null;
    let word: Word;
    try {
      word = new Word(text, loaded, opts.look ?? 'gold', stage.viewportBudget());
    } catch (err) {
      // This rejects before the settle() that would otherwise free the bloom's render targets.
      bloom?.dispose();
      throw err;
    }
```

Select it in place of the three direct-render lines inside the `clock.subscribe` callback's
`try`:

```ts
          if (bloom) {
            bloom.render(stage.scene, stage.camera);
          } else {
            renderer.setRenderTarget(null);
            renderer.clear();
            renderer.render(stage.scene, stage.camera);
          }
```

Dispose it in `settle()`, before `stage.scheduleIdleTeardown()` — not in `finish()`. `settle`
is the one teardown that completion, abort and a throwing tick all reach; hanging disposal off
the completion path alone strands three render targets whenever an effect fails, and
`renderer.dispose()` frees none of them.

```ts
        bloom?.dispose();
```

- [ ] **Step 3: Test**

`BloomPath` needs a real `WebGLRenderer` to draw anything, but a stub renderer that records
`setRenderTarget`/`render` reveals the whole pass structure, and the render targets and
materials are plain JS until a frame is submitted. What the shaders compute is not reachable
in the `node` environment; Task 19 is where the composite's alpha gets verified.

`packages/core/test/render/bloom.test.ts`:

```ts
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BloomPath, DEFAULT_BLOOM } from '../../src/render/bloom.js';

/** What a single draw saw: uniforms are reused across passes, so textures are snapshotted. */
interface Pass {
  scene: THREE.Scene;
  target: THREE.WebGLRenderTarget | null;
  material: THREE.ShaderMaterial | null;
  source: THREE.Texture | null;
  bloom: THREE.Texture | null;
  dir: THREE.Vector2 | null;
}

function harness(width = 640, height = 480) {
  const size = new THREE.Vector2(width, height);
  const passes: Pass[] = [];
  let target: THREE.WebGLRenderTarget | null = null;

  const renderer = {
    getDrawingBufferSize: (out: THREE.Vector2) => out.copy(size),
    setRenderTarget: vi.fn((next: THREE.WebGLRenderTarget | null) => {
      target = next;
    }),
    clear: vi.fn(),
    render: vi.fn((scene: THREE.Scene) => {
      const mesh = scene.children[0] as THREE.Mesh | undefined;
      const material = (mesh?.material as THREE.ShaderMaterial | undefined) ?? null;
      const uniforms = material?.uniforms;
      const dir = uniforms?.dir?.value as THREE.Vector2 | undefined;
      passes.push({
        scene,
        target,
        material,
        source: ((uniforms?.tDiffuse ?? uniforms?.tBase)?.value ?? null) as THREE.Texture | null,
        bloom: (uniforms?.tBloom?.value ?? null) as THREE.Texture | null,
        dir: dir ? dir.clone() : null,
      });
    }),
  } as unknown as THREE.WebGLRenderer;

  return { renderer, passes, size };
}

function pass(passes: Pass[], index: number): Pass {
  const found = passes[index];
  if (!found) throw new Error(`no pass ${index} of ${passes.length}`);
  return found;
}

function renderOnce(path: BloomPath): THREE.Scene {
  const scene = new THREE.Scene();
  path.render(scene, new THREE.PerspectiveCamera());
  return scene;
}

interface Freeable {
  addEventListener(type: 'dispose', listener: () => void): void;
}

/** Counts dispose events, which is the only externally visible signal that GPU memory came back. */
function watchDisposal(...targets: Freeable[]): () => number {
  let count = 0;
  for (const t of targets) t.addEventListener('dispose', () => count++);
  return () => count;
}

describe('BloomPath.render', () => {
  it('draws the scene at full resolution and the glow at half', () => {
    const { renderer, passes } = harness(640, 480);
    const scene = renderOnce(new BloomPath(renderer));

    expect(passes).toHaveLength(7);
    const scenePass = pass(passes, 0);
    expect(scenePass.scene).toBe(scene);
    expect([scenePass.target?.width, scenePass.target?.height]).toEqual([640, 480]);
    for (const i of [1, 2, 3, 4, 5]) {
      expect([pass(passes, i).target?.width, pass(passes, i).target?.height]).toEqual([320, 240]);
    }
  });

  it('thresholds the scene, then ping-pongs a separable blur at two radii', () => {
    const { renderer, passes } = harness(640, 480);
    new BloomPath(renderer).render(new THREE.Scene(), new THREE.PerspectiveCamera());

    const sceneRT = pass(passes, 0).target;
    const brightRT = pass(passes, 1).target;
    const blurRT = pass(passes, 2).target;
    expect(pass(passes, 1).source).toBe(sceneRT?.texture);
    expect(pass(passes, 1).material?.uniforms.threshold?.value).toBe(DEFAULT_BLOOM.threshold);

    // Each pass reads what the previous one wrote; a stale read would blur the same texture twice.
    const blur = [2, 3, 4, 5].map((i) => pass(passes, i));
    expect(blur.map((p) => p.target)).toEqual([blurRT, brightRT, blurRT, brightRT]);
    expect(blur.map((p) => p.source)).toEqual([
      brightRT?.texture,
      blurRT?.texture,
      brightRT?.texture,
      blurRT?.texture,
    ]);
    expect(blur.map((p) => p.dir?.toArray())).toEqual([
      [1 / 320, 0],
      [0, 1 / 240],
      [2.5 / 320, 0],
      [0, 2.5 / 240],
    ]);
  });

  it('composites the scene and the blurred glow to the canvas last', () => {
    const { renderer, passes } = harness(640, 480);
    new BloomPath(renderer).render(new THREE.Scene(), new THREE.PerspectiveCamera());

    const composite = pass(passes, 6);
    expect(composite.target).toBeNull();
    expect(composite.source).toBe(pass(passes, 0).target?.texture);
    expect(composite.bloom).toBe(pass(passes, 5).target?.texture);
    expect(composite.material?.uniforms.strength?.value).toBe(DEFAULT_BLOOM.strength);
    expect(composite.material?.uniforms.alphaBoost?.value).toBe(DEFAULT_BLOOM.alphaBoost);
  });

  it('encodes the composite for the canvas, which only a direct render gets for free', () => {
    const { renderer, passes } = harness();
    new BloomPath(renderer).render(new THREE.Scene(), new THREE.PerspectiveCamera());

    expect(pass(passes, 6).material?.fragmentShader).toContain('#include <colorspace_fragment>');
    expect(pass(passes, 1).material?.fragmentShader).not.toContain('colorspace_fragment');
  });

  it('carries custom options into the uniforms', () => {
    const { renderer, passes } = harness();
    const path = new BloomPath(renderer, { strength: 2, threshold: 0.1, alphaBoost: 0.25 });
    renderOnce(path);

    expect(pass(passes, 1).material?.uniforms.threshold?.value).toBe(0.1);
    expect(pass(passes, 6).material?.uniforms.strength?.value).toBe(2);
    expect(pass(passes, 6).material?.uniforms.alphaBoost?.value).toBe(0.25);
  });
});

describe('BloomPath target allocation', () => {
  it('follows a drawing buffer that changed under it, and frees what it replaced', () => {
    const { renderer, passes, size } = harness(640, 480);
    const path = new BloomPath(renderer);
    renderOnce(path);

    const disposed = watchDisposal(
      pass(passes, 0).target as THREE.WebGLRenderTarget,
      pass(passes, 1).target as THREE.WebGLRenderTarget,
      pass(passes, 2).target as THREE.WebGLRenderTarget,
    );

    size.set(1000, 800);
    renderOnce(path);

    expect(disposed()).toBe(3);
    expect([pass(passes, 7).target?.width, pass(passes, 7).target?.height]).toEqual([1000, 800]);
    expect([pass(passes, 8).target?.width, pass(passes, 8).target?.height]).toEqual([500, 400]);
  });

  it('reuses the targets while the drawing buffer holds still', () => {
    const { renderer, passes } = harness(640, 480);
    const path = new BloomPath(renderer);
    renderOnce(path);
    const disposed = watchDisposal(pass(passes, 0).target as THREE.WebGLRenderTarget);
    renderOnce(path);

    expect(disposed()).toBe(0);
    expect(pass(passes, 7).target).toBe(pass(passes, 0).target);
  });

  it('clamps a zero-sized drawing buffer to something allocatable', () => {
    const { renderer, passes } = harness(0, 0);
    renderOnce(new BloomPath(renderer));

    expect([pass(passes, 0).target?.width, pass(passes, 0).target?.height]).toEqual([2, 2]);
    expect([pass(passes, 1).target?.width, pass(passes, 1).target?.height]).toEqual([1, 1]);
  });
});

describe('BloomPath.dispose', () => {
  it('frees every render target and material', () => {
    const { renderer, passes } = harness();
    const path = new BloomPath(renderer);
    renderOnce(path);

    const materials = [1, 2, 6].map((i) => pass(passes, i).material as THREE.ShaderMaterial);
    const targets = [0, 1, 2].map((i) => pass(passes, i).target as THREE.WebGLRenderTarget);
    const quad = pass(passes, 1).scene.children[0] as THREE.Mesh;
    const disposed = watchDisposal(...targets, ...materials, quad.geometry);

    path.dispose();
    expect(disposed()).toBe(7);
  });
});
```

Append to the `createBlitsklieg` describe in `packages/core/test/index.test.ts`, with
`BloomPath` imported and `getDrawingBufferSize: (out: THREE.Vector2) => out.set(320, 240)`
added to the `renderer` stub:

```ts
  describe('bloom', () => {
    /** Real disposal, stubbed drawing: the constructor allocates the targets either way. */
    function stubBloom(render = true) {
      const spies = {
        render: vi.spyOn(BloomPath.prototype, 'render'),
        dispose: vi.spyOn(BloomPath.prototype, 'dispose'),
      };
      if (render) spies.render.mockImplementation(() => {});
      return spies;
    }

    it('renders through the bloom path instead of straight to the canvas', async () => {
      const bloom = stubBloom();
      const bk = create();
      const done = bk.fire('HI', { ...INSTANT, bloom: true });

      await flush();
      clock.advance(16);
      await done;

      expect(bloom.render).toHaveBeenCalledTimes(1);
      expect(bloom.render).toHaveBeenCalledWith(stage().scene, stage().camera);
      expect(renders).toBe(0);
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });

    it('builds nothing when bloom is off', async () => {
      const bloom = stubBloom();
      const bk = create();
      const done = bk.fire('HI', INSTANT);

      await flush();
      clock.advance(16);
      await done;

      expect(bloom.render).not.toHaveBeenCalled();
      expect(bloom.dispose).not.toHaveBeenCalled();
      expect(renders).toBe(1);
    });

    it('disposes the bloom path when the effect is aborted', async () => {
      const bloom = stubBloom();
      const bk = create();
      const done = bk.fire('HI', { bloom: true, hold: 5000 });

      await flush();
      clock.advance(16);
      bk.destroy();
      await done;

      expect(bloom.render).toHaveBeenCalledTimes(1);
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });

    it('disposes the bloom path when the word fails to build', async () => {
      const bloom = stubBloom();
      parse.mockReturnValue({
        ...stubFont(),
        charToGlyph: () => {
          throw new Error('bad glyph');
        },
      } as unknown as Font);
      const bk = create();

      // The rejection comes out before the promise that owns settle() exists.
      await expect(bk.fire('HI', { ...INSTANT, bloom: true })).rejects.toThrow('bad glyph');
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });

    it('disposes the bloom path when a tick throws', async () => {
      const bloom = stubBloom(false);
      onRender = () => {
        throw new Error('context lost');
      };
      const bk = create();
      const done = bk.fire('HI', { ...INSTANT, bloom: true });

      await flush();
      clock.advance(16);

      await expect(done).rejects.toThrow('context lost');
      // The throw came out of the scene pass, so the composite never ran and the targets are live.
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });
  });
```

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: all clean, 202 tests across 17 files.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/bloom.ts packages/core/src/index.ts
git add packages/core/test/render/bloom.test.ts packages/core/test/index.test.ts
git commit -m "add opt-in bloom path with alpha-preserving composite"
```

---

## Task 18: Lab app

**Files:**
- Create: `apps/lab/package.json`, `apps/lab/index.html`, `apps/lab/src/main.ts`, `apps/lab/vite.config.ts`
- Create: `apps/lab/tsconfig.json`
- Create: `apps/lab/public/font.ttf`, `apps/lab/public/OFL.txt`
- Modify: `tsconfig.json` (root) — add the `apps/lab` reference

- [ ] **Step 1: apps/lab/package.json**

```json
{
  "name": "@blitsklieg/lab",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": { "@blitsklieg/core": "*" },
  "devDependencies": { "vite": "^6.0.3" }
}
```

- [ ] **Step 2: apps/lab/vite.config.ts**

```ts
import { defineConfig } from 'vite';

export default defineConfig({ server: { port: 5180 } });
```

- [ ] **Step 2b: Put the lab under typecheck**

`apps/lab/src/main.ts` is the only code in this plan that consumes the public API from outside
the package, so it is the only place a broken public surface shows up. Without its own tsconfig
and a root reference, `npm run typecheck` never looks at it.

`apps/lab/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src", "vite.config.ts"],
  "references": [{ "path": "../../packages/core" }]
}
```

Then add the reference to the root `tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "packages/core" }, { "path": "apps/lab" }]
}
```

Confirm the reference is live rather than assuming it: put a bogus name in one of the record
literals in Step 4 and check that `npm run typecheck` fails on `apps/lab/src/main.ts`. A
reference that never gets built is the failure mode here, and it is silent.

- [ ] **Step 2c: The font**

Archivo Black, under the SIL Open Font License, fetched with its license text:

```bash
curl -o apps/lab/public/font.ttf https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/ArchivoBlack-Regular.ttf
curl -o apps/lab/public/OFL.txt https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/OFL.txt
```

Do not copy a face off the machine instead: installed system fonts are licensed to the machine,
not to a repo that will be published. Any OFL face works; commit its license next to it.

- [ ] **Step 3: apps/lab/index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>blitsklieg lab</title>
    <style>
      body { margin: 0; font: 15px/1.6 system-ui; background: #10131a; color: #e6e9f0; }
      main { max-width: 900px; margin: 0 auto; padding: 24px; min-height: 150vh; }
      .panel { position: fixed; top: 12px; right: 12px; width: 250px; display: grid; gap: 6px;
               background: #0c0f16e8; border: 1px solid #2a3142; border-radius: 10px;
               padding: 12px; font: 12px ui-monospace, monospace; z-index: 10; }
      .panel label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .panel .row { display: flex; gap: 6px; }
      .panel .row button { flex: 1; }
      #sequences { border-top: 1px solid #2a3142; padding-top: 8px; }
      input, select, button { font: 12px ui-monospace, monospace; padding: 5px; }
      #text { width: 100%; box-sizing: border-box; }
      #log { margin: 4px 0 0; max-height: 9em; overflow-y: auto; white-space: pre-wrap;
             color: #9aa3b8; border-top: 1px solid #2a3142; padding-top: 6px; }
    </style>
  </head>
  <body>
    <main>
      <h1>blitsklieg lab</h1>
      <p>The overlay renders above this page. Scroll — the type holds position and the text
         stays readable through it.</p>
      <p>Space fires. The selects are built from the exported name unions, so every motion slot
         and look the package ships is reachable here.</p>
      <p id="filler"></p>
    </main>
    <div class="panel">
      <input id="text" type="text" value="JACKPOT!" autocomplete="off" spellcheck="false" />
      <label>enter <select id="enter"></select></label>
      <label>active <select id="active"></select></label>
      <label>exit <select id="exit"></select></label>
      <label>look <select id="look"></select></label>
      <label>policy <select id="policy"></select></label>
      <label>hold ms <input id="hold" type="number" value="1200" min="0" step="100" /></label>
      <label>blend ms <input id="blend" type="number" value="120" min="0" step="10" /></label>
      <label>bloom <input id="bloom" type="checkbox" /></label>
      <div class="row">
        <button id="fire">FIRE</button>
        <button id="burst">FIRE x3</button>
        <button id="destroy">DESTROY</button>
      </div>
      <div class="row" id="sequences"></div>
      <pre id="log"></pre>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

The `<select>`s and the sequence row are empty on purpose — `main.ts` fills them from the
package's exported name lists, so a renamed name cannot rot into a dead `<option>`.

- [ ] **Step 4: apps/lab/src/main.ts**

```ts
import {
  ACTIVE_NAMES,
  type Blitsklieg,
  ENTER_NAMES,
  EXIT_NAMES,
  type FireOptions,
  LOOK_NAMES,
  POLICY_NAMES,
  createBlitsklieg,
} from '@blitsklieg/core';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`lab: the page has no #${id}`);
  return found as T;
}

const logEl = el<HTMLPreElement>('log');
const lines: string[] = [];

function log(line: string): void {
  lines.push(`${new Date().toLocaleTimeString()} ${line}`);
  if (lines.length > 40) lines.shift();
  logEl.textContent = lines.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}

function choice<T extends string>(id: string, names: readonly T[]) {
  const select = el<HTMLSelectElement>(id);
  for (const name of names) select.add(new Option(name));
  return { select, get: () => select.value as T };
}

const enter = choice('enter', ENTER_NAMES);
const active = choice('active', ACTIVE_NAMES);
const exit = choice('exit', EXIT_NAMES);
const look = choice('look', LOOK_NAMES);
const policy = choice('policy', POLICY_NAMES);

const textInput = el<HTMLInputElement>('text');
const bloomInput = el<HTMLInputElement>('bloom');
const number = (id: string) => Number(el<HTMLInputElement>(id).value);

function create(): Blitsklieg {
  const instance = createBlitsklieg({ fontUrl: '/font.ttf', policy: policy.get() });
  log(`instance up (policy ${policy.get()}${instance.supported ? '' : ', webgl2 UNSUPPORTED'})`);
  return instance;
}

let bk = create();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function fire(text: string): void {
  log(`fire "${text}"`);
  bk.fire(text, {
    enter: enter.get(),
    active: active.get(),
    exit: exit.get(),
    look: look.get(),
    hold: number('hold'),
    blendMs: number('blend'),
    bloom: bloomInput.checked,
    placement: { kind: 'fullscreen' },
  }).then(
    () => log(`done  "${text}"`),
    (err: unknown) => {
      log(`FAILED "${text}": ${message(err)}`);
      console.error(err);
    },
  );
}

interface Step extends FireOptions {
  text: string;
}

const SEQUENCES: { name: string; steps: Step[] }[] = [
  {
    name: 'enters',
    steps: ENTER_NAMES.filter((name) => name !== 'none').map((name) => ({
      text: name.toUpperCase(),
      enter: name,
      active: 'none',
      exit: 'fade',
      hold: 400,
    })),
  },
  {
    name: 'looks',
    steps: LOOK_NAMES.map((name) => ({
      text: name.toUpperCase(),
      look: name,
      enter: 'rise',
      active: 'sweep',
      exit: 'recede',
      hold: 900,
    })),
  },
  {
    name: 'moment',
    steps: [
      { text: 'THREE', enter: 'rise', active: 'float', exit: 'recede', look: 'chrome', hold: 150 },
      { text: 'TWO', enter: 'rise', active: 'float', exit: 'recede', look: 'chrome', hold: 150 },
      { text: 'ONE', enter: 'rise', active: 'pulse', exit: 'recede', look: 'oil', hold: 150 },
      {
        text: 'JACKPOT!',
        enter: 'slam',
        active: 'sweep',
        exit: 'shatter',
        look: 'gold',
        hold: 2400,
        bloom: true,
      },
    ],
  },
];

let playing = false;

async function play(sequence: (typeof SEQUENCES)[number]): Promise<void> {
  if (playing) return;
  playing = true;
  // Disabled rather than silently ignored: a sequence runs for seconds, and the greyed button is
  // the only cue that a second click would do nothing.
  for (const button of sequenceButtons) button.disabled = true;
  log(`sequence "${sequence.name}"`);
  // Captured once: bk may be reassigned mid-sequence (DESTROY, policy change), and this
  // instance's fire() must keep resolving instead of handing later steps to a new one.
  const instance = bk;
  try {
    for (const { text, ...options } of sequence.steps) {
      await instance.fire(text, options);
      log(`  done  "${text}"`);
    }
    log(`sequence "${sequence.name}" done`);
  } catch (err) {
    log(`sequence "${sequence.name}" FAILED: ${message(err)}`);
    console.error(err);
  } finally {
    playing = false;
    for (const button of sequenceButtons) button.disabled = false;
  }
}

const sequenceRow = el('sequences');
const sequenceButtons = SEQUENCES.map((sequence) => {
  const button = document.createElement('button');
  button.textContent = sequence.name;
  button.addEventListener('click', () => void play(sequence));
  sequenceRow.append(button);
  return button;
});

const fireCurrent = () => fire(textInput.value);

el('fire').addEventListener('click', fireCurrent);
el('burst').addEventListener('click', () => {
  for (const n of [1, 2, 3]) fire(`${textInput.value} ${n}`);
});
el('destroy').addEventListener('click', () => {
  bk.destroy();
  log('destroyed');
  bk = create();
});
policy.select.addEventListener('change', () => {
  bk.destroy();
  bk = create();
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fireCurrent();
});
addEventListener('keydown', (e) => {
  // Space must not swallow typing, nor double-fire the button it already activated.
  const inPanel = e.target instanceof HTMLElement && e.target.closest('.panel') !== null;
  if (e.code !== 'Space' || inPanel) return;
  e.preventDefault();
  fireCurrent();
});

addEventListener('unhandledrejection', (e) => log(`unhandled rejection: ${String(e.reason)}`));
addEventListener('error', (e) => log(`error: ${e.message}`));

if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  log('prefers-reduced-motion is on — the type holds a pose instead of travelling');
}

el('filler').textContent = 'Filler copy so the page scrolls. '.repeat(60);
```

What the shape is protecting, if you edit it:

- `fire()` rejects when the font fails to load and when a render tick throws. Every call site
  catches and writes to the panel log; a bare `void bk.fire(...)` turns both into an unhandled
  rejection with nothing on screen to explain it.
- The panel covers all of `FireOptions` — `hold`, `blendMs`, `bloom`, `placement` — plus the
  queue policy, which is a constructor option, so changing it rebuilds the instance.
- `FIRE x3` is what makes `queue` / `replace` / `concurrent` visible; nothing else in the lab
  fires while an effect is already running.
- The three sequences are data, not click handlers, and each step is awaited so its own `hold`
  and exit set the pacing. Their buttons disable while one plays, which both prevents stacking
  sequences on the queue and shows that the click was refused.

- [ ] **Step 5: Run it**

Run: `npm install && npm run dev -w @blitsklieg/lab`
Expected: server on `http://localhost:5180`. FIRE renders gold type over the page; the page
scrolls behind it and stays readable; the log gets a `fire` line then a `done` line. Every
enter, active, exit and look fires without error, and `moment` ends on a bloom-lit `JACKPOT!`.

Screenshots of a settled effect come out blank: the canvas is not `preserveDrawingBuffer`, so
anything captured after the effect ends is empty, and a driver round-trip can easily outlast a
short step. Capture while the effect is still on screen, or sample `gl.readPixels` inside a
`requestAnimationFrame` — Task 19 depends on getting this right.

- [ ] **Step 6: Commit**

```bash
git add apps tsconfig.json package-lock.json
git commit -m "add lab app exercising every motion slot and look"
```

---

## Task 19: Visual regression

**Files:**
- Create: `apps/lab/test/visual.spec.ts`, `playwright.config.ts`
- Modify: `biome.json`, `.gitignore`, `apps/lab/tsconfig.json`, `package.json`

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

Root devDependency only. `packages/core` must not gain a test-runner dependency.

- [ ] **Step 2: playwright.config.ts**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/lab/test',
  // Reusing a server in CI can serve stale code from a previous run's leftover process.
  webServer: {
    command: 'npm run dev -w @blitsklieg/lab',
    port: 5180,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:5180',
    // The specs read the whole drawing buffer back every frame; a modest 1x buffer keeps that
    // cheap enough to stay in step with the render loop.
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  },
});
```

- [ ] **Step 3: Keep `npm run check` clean**

`vitest.config.ts` includes only `packages/*/test/**/*.test.ts`, so a `.spec.ts` under `apps/`
is already out of the unit run — 202 tests across 17 files, unchanged.

Three files do need editing. biome does not read `.gitignore`, so Playwright's output
directories have to join its own ignore list or `npm run lint` fails the moment anyone runs
the suite:

```json
  "files": { "ignore": ["dist", "node_modules", "spikes", "test-results", "playwright-report"] }
```

`.gitignore` gains `test-results/` and `playwright-report/`. And `apps/lab/tsconfig.json`
includes `test` the way `packages/core/tsconfig.json` already does, so `tsc -b` typechecks the
spec:

```json
  "include": ["src", "test", "vite.config.ts"],
```

- [ ] **Step 4: Write the test**

Three properties, none of which any test in `packages/core/test` can reach: the direct path
draws lit letters over a transparent field, the bloom path does the same through its composite
shader, and the canvas does not eat clicks meant for the page under it.

**Sample inside `requestAnimationFrame`.** `readPixels` after the effect settles returns all
zeros — measured, not assumed: the drafted `waitForTimeout(1000)` shape reports
`{clear: 480000, lit: 0}`, because the canvas is not `preserveDrawingBuffer` and the buffer is
cleared at composite. A rAF callback runs after the library's own rAF-driven draw, so it sees
the frame. Do not add `preserveDrawingBuffer` to `stage.ts` for this; it is a real cost paid by
every consumer to work around a test that was sampling at the wrong moment.

**Fail loudly on an empty buffer.** The `clear > lit` assertion passes trivially when nothing
drew (480000 > 0). `drawn`, the count of sampled frames holding any lit pixel, is the guard
that separates "the overlay is transparent" from "the sampler never saw a frame".

**Assert both paths.** The bloom composite computes the overlay's alpha itself, in a shader
nothing in `packages/core/test` can execute. Forcing that shader's alpha to `1.0` fails the
bloom spec at 480000 of 480000 pixels non-transparent and leaves the direct spec green — the
direct path never runs it.

**No ManualClock.** The lab does not pass a `clock`, and it should not grow a test-only hook to.
The assertions are pixel-count inequalities taken over the busiest of many frames, so they hold
for any frame in which anything drew; which frame the sampler landed on does not enter into it.

```ts
import { type Page, expect, test } from '@playwright/test';

/** Alpha census of one frame of the overlay's drawing buffer. */
interface Frame {
  lit: number;
  clear: number;
  total: number;
}

interface Reading {
  frames: number;
  drawn: number;
  best: Frame;
}

const SAMPLE_FRAMES = 24;

/**
 * Reports the busiest of `frames` consecutive frames of the overlay's own drawing buffer.
 *
 * `readPixels` after the effect settles returns zeros — the buffer is not `preserveDrawingBuffer`,
 * so it is cleared once the page composites. Reading from `requestAnimationFrame`, which runs
 * after the library's own rAF-driven draw, is the only way to see what the overlay put on screen.
 */
function readOverlay(page: Page, frames: number): Promise<Reading> {
  return page.evaluate(
    (count) =>
      new Promise<Reading>((resolve, reject) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return reject(new Error('the overlay never created a canvas'));
        const gl = canvas.getContext('webgl2');
        if (!gl) return reject(new Error('the overlay canvas has no webgl2 context'));

        const { width, height } = canvas;
        const px = new Uint8Array(width * height * 4);
        const total = width * height;
        let sampled = 0;
        let drawn = 0;
        let best: Frame = { lit: 0, clear: total, total };

        const step = () => {
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let lit = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) lit++;

          sampled++;
          if (lit > 0) drawn++;
          if (lit > best.lit) best = { lit, clear: total - lit, total };

          if (sampled < count) requestAnimationFrame(step);
          else resolve({ frames: sampled, drawn, best });
        };
        requestAnimationFrame(step);
      }),
    frames,
  );
}

/** Fires one long-held effect and returns once its canvas is on the page. */
async function fire(page: Page, options: { bloom: boolean }): Promise<void> {
  await page.goto('/');
  // Long enough that the sampler, slowed by a full-buffer readPixels per frame, stays inside it.
  await page.locator('#hold').fill('4000');
  if (options.bloom) await page.locator('#bloom').check();
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();
}

function expectTransparentOverlay(reading: Reading): void {
  expect(
    reading.drawn,
    `not one of ${reading.frames} sampled frames held a non-transparent pixel: either the letters never drew, or the sampler never caught a live draw and the check below proves nothing`,
  ).toBeGreaterThan(0);
  expect(
    reading.best.clear,
    `the overlay composited as an opaque rectangle: ${reading.best.lit} of ${reading.best.total} pixels are non-transparent`,
  ).toBeGreaterThan(reading.best.lit);
}

test('the direct path lights the letters and leaves the rest of the overlay transparent', async ({
  page,
}) => {
  await fire(page, { bloom: false });
  expectTransparentOverlay(await readOverlay(page, SAMPLE_FRAMES));
});

// The composite shader computes the glow's alpha as max(base.a, luma * alphaBoost), which is the
// likeliest place for the whole canvas to go opaque. The direct path never runs that shader.
test('the bloom path lights the letters and leaves the rest of the overlay transparent', async ({
  page,
}) => {
  await fire(page, { bloom: true });
  expectTransparentOverlay(await readOverlay(page, SAMPLE_FRAMES));
});

test('the overlay does not intercept clicks meant for the page beneath it', async ({ page }) => {
  await fire(page, { bloom: false });
  // The canvas covers the panel at z-index 2147483000, so this second click only reaches the
  // button if pointer-events:none holds; without it Playwright times out on the action itself.
  await page.locator('#text').fill('SECOND');
  await page.getByRole('button', { name: 'FIRE', exact: true }).click({ timeout: 5000 });
  await expect(page.locator('#log')).toContainText('fire "SECOND"');
});
```

- [ ] **Step 5: Run**

Run: `npx playwright test`
Expected: PASS, 3 tests. Roughly 7s, one worker.

Observed alpha census on the busiest frame at 800x600: direct path 30122 lit of 480000, bloom
path 54776 of 480000, all 24 sampled frames drawn in both.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts apps/lab/test apps/lab/tsconfig.json biome.json .gitignore
git add package.json package-lock.json
git commit -m "add visual regression asserting the overlay stays transparent"
```

---

## Deferred

Not in this plan, by decision in the spec:

- `@blitsklieg/react` — thin binding, its own plan once core is judged visually.
- Particles (v1.1), element-anchored placement (v1.2), `hold: 'until-dismissed'` with `dismiss()`.
- Per-letter opacity — v0 shares one material across letters, so `shatter` fades the word as a
  unit rather than per letter. Fixing this means cloning the material per letter; revisit only if
  it reads wrong in the lab.

## Wanted later — configurable and scriptable easing

Explicitly on the roadmap, deliberately **not** in v0: callers should be able to supply their own
easing, and eventually script it.

Nothing here forecloses that. `Easing` is already `(t: number) => number` — a plain function, the
only signature a scripted curve would need — and motion pieces call curves by reference rather
than inlining the math. The v0 constraint is only that the *set* is closed: `enter`/`active`/`exit`
take names, not functions.

The real design question when this lands is scope. Easing per effect (`{ enter: 'slam', ease:
easeOutCubic }`) is a small change. Easing per phase, or per letter, means the `MotionPiece`
contract grows a curve parameter and every piece has to declare which of its channels the curve
applies to — position, rotation, scale, or opacity — since a single piece drives several at once
and they rarely want the same shaping. Decide that boundary before writing code, not during.
