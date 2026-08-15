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
    index.ts              public surface: createBlitsklieg, types
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
      glyphs.ts           glyph -> ExtrudeGeometry, cached
      layout.ts           kerned advances, viewport fit
    render/
      environment.ts      procedural cubemap
      looks.ts            material presets
      stage.ts            renderer, scene, camera, lifecycle
      direct.ts           direct-to-canvas path
      bloom.ts            RT chain + alpha-preserving composite
  test/                   mirrors src/
apps/lab/                 Vite demo page
```

Pure logic (`clock`, `easing`, `pose`, `motion/`, `queue`, `text/layout`) never imports three.js.
That boundary is what keeps the test suite fast and meaningful.

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
export type QueuePolicy = 'queue' | 'replace' | 'concurrent';
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

  let font: Font;
  try {
    font = parse(await res.arrayBuffer());
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
    parse.mockReturnValue(stubFont({}));

    const loaded = await loadFont('/fonts/x.ttf');
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

/** Extents of a contour's own outline, ignoring any holes hanging off it. */
function topOf(contour: THREE.Path): number {
  return Math.max(...contour.getPoints(1).map((p) => p.y));
}

function bottomOf(contour: THREE.Path): number {
  return Math.min(...contour.getPoints(1).map((p) => p.y));
}

function leftOf(contour: THREE.Path): number {
  return Math.min(...contour.getPoints(1).map((p) => p.x));
}

describe('glyphToShapes', () => {
  it('negates y, because opentype paths are y-down and three is y-up', () => {
    const [shape] = glyphToShapes(fontDrawing(box(0, 0, 10, 10)), 'A', 1);

    expect(topOf(shape as THREE.Shape)).toBe(0);
    expect(bottomOf(shape as THREE.Shape)).toBe(-10);
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

/** Letters repeat heavily, so geometry is built once per (char, depth) and shared. */
export class GlyphCache<T extends Buildable = THREE.ExtrudeGeometry> {
  private cache = new Map<string, T>();

  constructor(private readonly build: (char: string, depth: number) => T) {}

  get size(): number {
    return this.cache.size;
  }

  get(char: string, depth: number): T {
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
        // three closes a contour by reading its first curve, so a contour that never drew one throws.
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
  const closed = contours
    .map((contour) => ({ contour, polygon: contour.getPoints(NESTING_SEGMENTS) }))
    .filter((c) => c.polygon.length >= 3);
  const anchors = closed.map((c) => c.polygon[0] as THREE.Vector2);
  const depths = anchors.map((anchor, i) =>
    closed.reduce((n, o, j) => (j !== i && containsPoint(o.polygon, anchor) ? n + 1 : n), 0),
  );

  const shapes: THREE.Shape[] = [];
  closed.forEach(({ contour }, i) => {
    const depth = depths[i] as number;
    const container =
      depth % 2 === 1
        ? closed.find(
            (o, j) =>
              depths[j] === depth - 1 && containsPoint(o.polygon, anchors[i] as THREE.Vector2),
          )
        : undefined;
    if (container) container.contour.holes.push(contour);
    else shapes.push(contour);
  });
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
Expected: PASS, 32 tests (11 layout, 7 font, 14 glyphs).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/text/ packages/core/test/text/glyphs.test.ts packages/core/test/text/font.test.ts
git commit -m "add opentype font loading and cached extruded glyph geometry"
```

---

## Task 13: Procedural environment and looks

**Files:**
- Create: `packages/core/src/render/environment.ts`, `packages/core/src/render/looks.ts`

- [ ] **Step 1: Write environment.ts**

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

/** A synthetic photo studio: dark shell plus bright bars, turned into a reflection probe. */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();

  scene.add(
    new THREE.Mesh(
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
    ),
  );

  for (const bar of BARS) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(bar.size[0], bar.size[1]),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(...bar.rgb),
        side: THREE.DoubleSide,
      }),
    );
    m.position.set(...bar.pos);
    m.lookAt(0, 0, 0);
    m.rotateZ(bar.rot);
    scene.add(m);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return texture;
}
```

- [ ] **Step 2: Write looks.ts**

```ts
import * as THREE from 'three';

export type LookName = 'gold' | 'chrome' | 'oil' | 'ruby';

interface LookParams {
  color: number;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  transmission: number;
  thickness: number;
  ior: number;
  attenuationColor: number;
  attenuationDistance: number;
  iridescence: number;
  iridescenceIOR: number;
  iridescenceThicknessRange: [number, number];
}

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

const COLOR_KEYS = new Set(['color', 'attenuationColor']);

export function createMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ envMapIntensity: 2.2 });
}

/**
 * Color-valued params are THREE.Color objects. Assigning a hex number over one replaces the
 * object and the material silently stops working, so they must go through .set().
 */
export function applyLook(material: THREE.MeshPhysicalMaterial, name: LookName): void {
  const params = { ...DEFAULTS, ...LOOKS[name] } as Record<string, unknown>;
  const target = material as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(params)) {
    if (COLOR_KEYS.has(key)) (target[key] as THREE.Color).set(value as number);
    else target[key] = value;
  }
  material.needsUpdate = true;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b packages/core`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/render/environment.ts packages/core/src/render/looks.ts
git commit -m "add procedural environment map and four material looks"
```

---

## Task 14: Stage — renderer, lifecycle, guardrails

**Files:**
- Create: `packages/core/src/render/stage.ts`

- [ ] **Step 1: Implement**

```ts
import * as THREE from 'three';
import { buildEnvironment } from './environment.js';

export interface StageOptions {
  target: HTMLElement;
  /** Idle milliseconds before the WebGL context is torn down. Browsers cap contexts near 16. */
  idleTimeoutMs: number;
}

export function webglSupported(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
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
  environment: THREE.Texture | null = null;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly opts: StageOptions) {
    this.camera.position.set(0, 0, 11);
  }

  /** Idempotent: repeated fires reuse one context rather than allocating a new one. */
  mount(): THREE.WebGLRenderer {
    this.cancelIdle();
    if (this.renderer) return this.renderer;

    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';
    this.opts.target.appendChild(canvas);

    // premultipliedAlpha:false so a straight-alpha composite does not produce bright halos.
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.canvas = canvas;
    this.renderer = renderer;
    this.environment = buildEnvironment(renderer);
    this.scene.environment = this.environment;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(document.documentElement);
    this.resize();

    return renderer;
  }

  resize(): void {
    if (!this.renderer) return;
    const w = globalThis.innerWidth;
    const h = globalThis.innerHeight;
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
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.environment?.dispose();
    this.environment = null;
    this.scene.environment = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas?.remove();
    this.canvas = null;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b packages/core`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/render/stage.ts
git commit -m "add stage with lazy webgl context, resize, and idle teardown"
```

---

## Task 15: Word — per-letter meshes driven by the timeline

**Files:**
- Create: `packages/core/src/render/word.ts`

- [ ] **Step 1: Implement**

```ts
import * as THREE from 'three';
import type { Timeline } from '../motion/compositor.js';
import { DEFAULT_GLYPH_OPTIONS, GlyphCache, buildGlyphGeometry } from '../text/glyphs.js';
import type { LoadedFont } from '../text/font.js';
import { fitScale, layoutLine } from '../text/layout.js';
import type { Budget } from '../text/layout.js';
import { applyLook, createMaterial, type LookName } from './looks.js';

const EM = 1; // glyphs are built at 1 em; the group scale does the fitting

/** One mesh per letter — per-letter motion (spin, flip, shatter) needs independent transforms. */
export class Word {
  readonly group = new THREE.Group();
  private readonly letters: THREE.Mesh[] = [];
  /** Layout x per letter. Pose x is an OFFSET onto this — overwriting it collapses the word. */
  private readonly baseX: number[] = [];
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly cache: GlyphCache;
  private baseScale = 1;

  constructor(
    private readonly text: string,
    font: LoadedFont,
    look: LookName,
    budget: Budget,
  ) {
    this.material = createMaterial();
    applyLook(this.material, look);
    this.cache = new GlyphCache((char, depth) =>
      buildGlyphGeometry(font.font, char, EM, { ...DEFAULT_GLYPH_OPTIONS, depth }),
    );

    const scaleToEm = EM / font.unitsPerEm;
    const line = layoutLine(text, font.metrics);

    let maxY = 0;
    for (const g of line.glyphs) {
      const x = g.x * scaleToEm;
      if (g.char === ' ') {
        this.letters.push(new THREE.Mesh()); // placeholder keeps indices aligned with the string
        this.baseX.push(x);
        continue;
      }
      const geo = this.cache.get(g.char, DEFAULT_GLYPH_OPTIONS.depth);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.x = x;
      this.letters.push(mesh);
      this.baseX.push(x);
      this.group.add(mesh);
      maxY = Math.max(maxY, geo.boundingBox?.max.y ?? 0);
    }

    const width = line.width * scaleToEm;
    this.baseScale = fitScale(width, maxY, budget);
    this.group.scale.setScalar(this.baseScale);
    // Center on both axes so rotation pivots through the word, not its left edge.
    this.group.position.set((-width / 2) * this.baseScale, (-maxY / 2) * this.baseScale, 0);

    this.material.transparent = true;
  }

  get letterCount(): number {
    return this.letters.length;
  }

  apply(timeline: Timeline, elapsed: number): void {
    let opacity = 1;
    for (let i = 0; i < this.letters.length; i++) {
      const mesh = this.letters[i];
      if (!mesh?.geometry.attributes.position) continue;

      const pose = timeline.poseAt(elapsed, { index: i, count: this.letters.length });
      mesh.position.x = (this.baseX[i] as number) + pose.position[0];
      mesh.position.y = pose.position[1];
      mesh.position.z = pose.position[2];
      mesh.rotation.set(...pose.rotation);
      mesh.scale.setScalar(pose.scale);
      opacity = pose.opacity;
    }
    // One shared material, so opacity is a word-level property in v0.
    this.material.opacity = opacity;
  }

  dispose(): void {
    this.cache.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b packages/core`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/render/word.ts
git commit -m "add word with per-letter meshes driven by the timeline"
```

---

## Task 16: Public surface

**Files:**
- Create: `packages/core/src/index.ts`

**Publishing note (do not skip):** `packages/core/tsconfig.json` uses `rootDir: "."` with
`include: ["src", "test"]`, so emit lands at `dist/src/index.d.ts` — **not** `dist/index.d.ts`,
and `dist/test/` gets built too. If this task adds a `types` field, it must point at
`./dist/src/index.d.ts`, or the tsconfig must first be split into a `src`-only project plus a
`tsconfig.test.json` that references it. Writing the obvious-looking `./dist/index.d.ts` yields a
path that does not exist.

- [ ] **Step 1: Implement**

```ts
import { type Clock, RafClock } from './clock.js';
import { ACTIVE, ENV_DRIVEN } from './motion/active.js';
import { Timeline } from './motion/compositor.js';
import { ENTER } from './motion/enter.js';
import { EXIT } from './motion/exit.js';
import type { ActiveName, EnterName, ExitName } from './motion/types.js';
import { EffectQueue, type QueuePolicy } from './queue.js';
import type { LookName } from './render/looks.js';
import { Stage, prefersReducedMotion, webglSupported } from './render/stage.js';
import { Word } from './render/word.js';
import { type LoadedFont, loadFont } from './text/font.js';

export type { EnterName, ActiveName, ExitName, LookName, QueuePolicy, Clock };

export interface BlitskliegOptions {
  target?: HTMLElement;
  fontUrl: string;
  clock?: Clock;
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
  fire(text: string, options?: FireOptions): Promise<void>;
  destroy(): void;
}

export function createBlitsklieg(options: BlitskliegOptions): Blitsklieg {
  const supported = webglSupported();
  const clock = options.clock ?? new RafClock();
  const queue = new EffectQueue(options.policy ?? 'queue');
  const stage = new Stage({
    target: options.target ?? document.body,
    idleTimeoutMs: options.idleTimeoutMs ?? 8000,
  });

  let fontPromise: Promise<LoadedFont> | null = null;
  const font = () => (fontPromise ??= loadFont(options.fontUrl));

  async function run(text: string, opts: FireOptions, signal: AbortSignal): Promise<void> {
    const loaded = await font();
    if (signal.aborted) return;

    const renderer = stage.mount();
    const word = new Word(text, loaded, opts.look ?? 'gold', stage.viewportBudget());
    stage.scene.add(word.group);

    const activeName = opts.active ?? 'sweep';
    const timeline = new Timeline({
      enter: ENTER[opts.enter ?? 'slam'],
      active: ACTIVE[activeName],
      exit: EXIT[opts.exit ?? 'fade'],
      hold: opts.hold ?? 1200,
      blendMs: opts.blendMs ?? 120,
    });

    // Reduced motion: show the resting pose for the hold, then leave. No travel.
    const still = prefersReducedMotion();
    const startedAt = clock.now();

    await new Promise<void>((resolve) => {
      const finish = () => {
        off();
        stage.scene.remove(word.group);
        word.dispose();
        stage.scheduleIdleTeardown();
        resolve();
      };

      const off = clock.subscribe((now) => {
        if (signal.aborted) return finish();

        // Clamp BOTH ends. rAF delivers the frame-start time, which can precede a
        // performance.now() sampled moments earlier, so the first tick can be slightly negative.
        const elapsed = still ? timeline.duration - 1 : now - startedAt;
        word.apply(timeline, Math.min(Math.max(elapsed, 0), timeline.duration));

        if (ENV_DRIVEN.has(activeName) && 'environmentRotation' in stage.scene) {
          stage.scene.environmentRotation.y = now / ACTIVE[activeName].duration;
        }

        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(stage.scene, stage.camera);

        if (still ? now - startedAt >= (opts.hold ?? 1200) : timeline.isFinished(elapsed)) finish();
      });
    });
  }

  let counter = 0;

  return {
    supported,
    fire(text, opts = {}) {
      if (!supported) return Promise.resolve();
      return queue.push(`${counter++}:${text}`, (signal) => run(text, opts, signal));
    },
    destroy() {
      queue.cancelAll();
      stage.unmount();
    },
  };
}
```

- [ ] **Step 2: Typecheck and full check**

Run: `npm run check`
Expected: biome clean, tsc clean, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "add public createBlitsklieg surface wiring stage, timeline, and queue"
```

---

## Task 17: Bloom path

**Files:**
- Create: `packages/core/src/render/bloom.ts`
- Modify: `packages/core/src/index.ts` — select the path from `opts.bloom`

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

export class BloomPath {
  private sceneRT!: THREE.WebGLRenderTarget;
  private brightRT!: THREE.WebGLRenderTarget;
  private blurRT!: THREE.WebGLRenderTarget;

  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.Camera();
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));

  private readonly thresholdMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;

  constructor(private readonly renderer: THREE.WebGLRenderer, opts = DEFAULT_BLOOM) {
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const common = { depthTest: false, depthWrite: false, blending: THREE.NoBlending };

    this.thresholdMat = new THREE.ShaderMaterial({
      ...common,
      uniforms: { tDiffuse: { value: null }, threshold: { value: opts.threshold } },
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
      uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } },
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
        tBase: { value: null },
        tBloom: { value: null },
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
        }`,
    });

    this.resize();
  }

  resize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, size.x);
    const h = Math.max(2, size.y);
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

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;

    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    this.thresholdMat.uniforms.tDiffuse.value = this.sceneRT.texture;
    this.blit(this.thresholdMat, this.brightRT);

    for (const radius of [1, 2.5]) {
      this.blurMat.uniforms.tDiffuse.value = this.brightRT.texture;
      this.blurMat.uniforms.dir.value.set(radius / this.brightRT.width, 0);
      this.blit(this.blurMat, this.blurRT);
      this.blurMat.uniforms.tDiffuse.value = this.blurRT.texture;
      this.blurMat.uniforms.dir.value.set(0, radius / this.brightRT.height);
      this.blit(this.blurMat, this.brightRT);
    }

    this.compositeMat.uniforms.tBase.value = this.sceneRT.texture;
    this.compositeMat.uniforms.tBloom.value = this.brightRT.texture;
    this.blit(this.compositeMat, null);
  }

  private blit(material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
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

Replace the three direct-render lines in the `clock.subscribe` callback:

```ts
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(stage.scene, stage.camera);
```

with:

```ts
        if (bloom) {
          bloom.render(stage.scene, stage.camera);
        } else {
          renderer.setRenderTarget(null);
          renderer.clear();
          renderer.render(stage.scene, stage.camera);
        }
```

And create it just after `const renderer = stage.mount();`:

```ts
    const bloom = opts.bloom ? new BloomPath(renderer) : null;
```

Dispose it inside `finish()`, before `stage.scheduleIdleTeardown()`:

```ts
        bloom?.dispose();
```

Add the import at the top of `index.ts`:

```ts
import { BloomPath } from './render/bloom.js';
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/render/bloom.ts packages/core/src/index.ts
git commit -m "add opt-in bloom path with alpha-preserving composite"
```

---

## Task 18: Lab app

**Files:**
- Create: `apps/lab/package.json`, `apps/lab/index.html`, `apps/lab/src/main.ts`, `apps/lab/vite.config.ts`
- Create: `apps/lab/tsconfig.json`
- Modify: `tsconfig.json` (root) — add the `apps/lab` reference
- Create: `apps/lab/public/font.ttf` — download any bold TTF (Inter Bold, Archivo Black)

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

- [ ] **Step 3: apps/lab/index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>blitsklieg lab</title>
    <style>
      body { margin: 0; font: 15px/1.6 system-ui; background: #10131a; color: #e6e9f0; }
      main { max-width: 900px; margin: 0 auto; padding: 24px 24px 60vh; }
      .panel { position: fixed; top: 12px; right: 12px; display: grid; gap: 6px;
               background: #0c0f16e8; border: 1px solid #2a3142; border-radius: 10px;
               padding: 12px; font: 12px ui-monospace, monospace; z-index: 10; }
      select, button { font: 12px ui-monospace, monospace; padding: 5px; }
    </style>
  </head>
  <body>
    <main>
      <h1>blitsklieg lab</h1>
      <p>The overlay renders above this page. Scroll — the type holds position and the text
         stays readable through it.</p>
      <p id="filler"></p>
    </main>
    <div class="panel">
      <input id="text" type="text" value="JACKPOT!" autocomplete="off" spellcheck="false" />
      <select id="enter">
        <option>slam</option><option>spin</option><option>flip</option>
        <option>assemble</option><option>rise</option><option>none</option>
      </select>
      <select id="active">
        <option>sweep</option><option>float</option><option>pulse</option>
        <option>shimmer</option><option>none</option>
      </select>
      <select id="exit">
        <option>fade</option><option>shatter</option><option>drop</option>
        <option>recede</option><option>none</option>
      </select>
      <select id="look">
        <option>gold</option><option>chrome</option><option>oil</option><option>ruby</option>
      </select>
      <label><input type="checkbox" id="bloom" /> bloom</label>
      <button id="fire">FIRE</button>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: apps/lab/src/main.ts**

```ts
import {
  type ActiveName,
  type EnterName,
  type ExitName,
  type LookName,
  createBlitsklieg,
} from '@blitsklieg/core';

document.getElementById('filler')!.textContent =
  'Filler copy so the page scrolls. '.repeat(60);

const bk = createBlitsklieg({ fontUrl: '/font.ttf' });
const pick = <T extends string>(id: string) =>
  (document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value as T;

const textInput = document.getElementById('text') as HTMLInputElement;

const fire = () =>
  void bk.fire(textInput.value, {
    enter: pick<EnterName>('enter'),
    active: pick<ActiveName>('active'),
    exit: pick<ExitName>('exit'),
    look: pick<LookName>('look'),
    bloom: (document.getElementById('bloom') as HTMLInputElement).checked,
  });

document.getElementById('fire')!.addEventListener('click', fire);
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fire();
});

addEventListener('keydown', (e) => {
  // Space fires, but must not swallow spaces typed into the text field.
  if (e.code !== 'Space' || e.target === textInput) return;
  e.preventDefault();
  fire();
});
```

- [ ] **Step 5: Run it**

Run: `npm install && npm run dev -w @blitsklieg/lab`
Expected: server on `http://localhost:5180`. Clicking FIRE renders gold type over the page;
the page scrolls behind it and stays readable.

- [ ] **Step 6: Commit**

```bash
git add apps/lab
git commit -m "add lab app exercising every motion slot and look"
```

---

## Task 19: Visual regression

**Files:**
- Create: `apps/lab/test/visual.spec.ts`, `playwright.config.ts`

- [ ] **Step 1: playwright.config.ts**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/lab/test',
  webServer: { command: 'npm run dev -w @blitsklieg/lab', port: 5180, reuseExistingServer: true },
  use: { baseURL: 'http://localhost:5180' },
});
```

- [ ] **Step 2: Write the test**

A ManualClock makes frames deterministic — without it screenshots differ every run.

```ts
import { expect, test } from '@playwright/test';

test('gold slam is fully opaque on the letters and transparent elsewhere', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'FIRE' }).click();
  await page.waitForTimeout(1000);

  const stats = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const gl = c.getContext('webgl2') as WebGL2RenderingContext;
    const px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let clear = 0;
    let lit = 0;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] === 0) clear++;
      else lit++;
    }
    return { clear, lit };
  });

  // Letters drew, and the overlay did not become an opaque rectangle.
  expect(stats.lit).toBeGreaterThan(0);
  expect(stats.clear).toBeGreaterThan(stats.lit);
});
```

**Note:** `readPixels` returns zeros outside a render callback because the drawing buffer is
cleared after compositing. If this test reports nothing drew, add `preserveDrawingBuffer: true`
to the renderer in `stage.ts` behind a test-only option rather than assuming the render broke.

- [ ] **Step 3: Run**

Run: `npx playwright test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts apps/lab/test
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
