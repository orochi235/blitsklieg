# Colour gradients implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `TubeSpec.gradient` — a colour sweep over a run, a glyph, the run list, a layer, or the whole sign — without moving any published look.

**Architecture:** Three evaluation tiers, one ramp. `gradient.ts` owns the ramp and the pure domain→`t` functions. Per-run domains (`runIndex`, `surface`) resolve in `assign` into `run.color`. Per-vertex domains (`run`, `letter`) write a `gradientT` float attribute in `buildTubeGeometry`. Positional domains (`axis`, `radial`) are computed in the vertex shader from a per-letter offset and word-bounds uniform, and sample a 256×1 `DataTexture` **baked by the same CPU ramp function**, so there is one ramp implementation and no CPU/GPU drift.

**Tech Stack:** TypeScript, three.js, vitest (unit), Playwright (visual baselines), React + windease (the tube lab).

The design this implements: [`docs/superpowers/specs/2026-08-20-colour-gradients-design.md`](../specs/2026-08-20-colour-gradients-design.md).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/render/tube/gradient.ts` | **New.** `GradientSpec` types, `rampAt`, `rampTexture`, and the pure per-run / per-vertex `t` functions. No three.js scene access, no shader strings. |
| `packages/core/src/render/tube/assign.ts` | Modify. Resolves per-run domains into `run.color`, in both modes. |
| `packages/core/src/render/tube/sweep.ts` | Modify. Writes the `gradientT` attribute for per-vertex domains. |
| `packages/core/src/render/tube/tint.ts` | Modify. Ramp lookup in the patched shader; positional `t`; domain in the program cache key. |
| `packages/core/src/render/tube/index.ts` | Modify. `TubeSpec.gradient`, and threading it to `assign` and `sweepRun`. |
| `packages/core/src/render/word.ts` | Modify. Bounds and per-letter offset uniforms. |
| `packages/core/dev/tube-lab/src/Rail.tsx` | Modify. Domain, mode and stop controls. |
| `packages/core/test/render/tube/gradient.test.ts` | **New.** The pure part. |

`gradient.ts` is deliberately free of scene and shader concerns so it can be unit tested without WebGL — the same split `bend.ts` and `resample.ts` already use.

---

## Task 1: The ramp

**Files:**
- Create: `packages/core/src/render/tube/gradient.ts`
- Test: `packages/core/test/render/tube/gradient.test.ts`

Stops interpolate in linear space. `new THREE.Color(hex)` already converts sRGB→linear under three's colour management — the same fact `sweep.ts` relies on today — so lerping `.r/.g/.b` of `THREE.Color` instances *is* the linear-space lerp.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/render/tube/gradient.test.ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rampAt } from '../../../src/render/tube/gradient.js';

describe('rampAt', () => {
  it('returns the only stop when there is one', () => {
    const c = rampAt([0xff2d95], 0.7);
    expect(c.getHex()).toBe(0xff2d95);
  });

  it('returns the endpoints at 0 and 1', () => {
    expect(rampAt([0xff0000, 0x0000ff], 0).getHex()).toBe(0xff0000);
    expect(rampAt([0xff0000, 0x0000ff], 1).getHex()).toBe(0x0000ff);
  });

  it('clamps outside 0..1 rather than extrapolating', () => {
    expect(rampAt([0xff0000, 0x0000ff], -3).getHex()).toBe(0xff0000);
    expect(rampAt([0xff0000, 0x0000ff], 9).getHex()).toBe(0x0000ff);
  });

  it('lands on an interior stop exactly', () => {
    const c = rampAt([0xff0000, 0x00ff00, 0x0000ff], 0.5);
    expect(c.getHex()).toBe(0x00ff00);
  });

  it('interpolates in linear space, not sRGB', () => {
    // The linear midpoint of black and white is mid-grey in LINEAR components, which is
    // 0.5 -> #bcbcbc once written back out as sRGB. An sRGB lerp would give #808080.
    const c = rampAt([0x000000, 0xffffff], 0.5);
    expect(c.r).toBeCloseTo(0.5, 6);
    expect(new THREE.Color().copy(c).getHexString()).toBe('bcbcbc');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/gradient.test.ts`
Expected: FAIL — `Failed to resolve import ".../gradient.js"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/render/tube/gradient.ts
import * as THREE from 'three';

/**
 * A colour the ramp passes through at `t`. Stops are sRGB hex; the returned colour is in three's
 * linear working space, because that is what `new THREE.Color(hex)` produces and what the shader
 * reads. Lerping sRGB components instead sends pink→cyan through grey.
 */
export function rampAt(stops: readonly number[], t: number): THREE.Color {
  if (stops.length === 0) return new THREE.Color(0xffffff);
  const first = stops[0] as number;
  if (stops.length === 1) return new THREE.Color(first);

  const u = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  const f = u - i;
  const a = new THREE.Color(stops[i] as number);
  const b = new THREE.Color(stops[i + 1] as number);
  return a.lerp(b, f);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/gradient.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/gradient.ts packages/core/test/render/tube/gradient.test.ts
git commit -m "add a linear-space colour ramp for tube gradients"
```

---

## Task 2: The spec type and the per-run `t` functions

**Files:**
- Modify: `packages/core/src/render/tube/gradient.ts`
- Test: `packages/core/test/render/tube/gradient.test.ts`

`runIndex` needs the lit run's ordinal and the lit count; `surface` needs the layer's ordinal in the spec's `surfaces` list. Both are constant within a run.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/tube/gradient.test.ts`:

```ts
import { perRunT } from '../../../src/render/tube/gradient.js';

describe('perRunT', () => {
  it('spreads runIndex across the lit runs', () => {
    expect(perRunT({ of: 'runIndex' }, { litOrdinal: 0, litCount: 5, surface: 'front' }, ['front'])).toBeCloseTo(0, 6);
    expect(perRunT({ of: 'runIndex' }, { litOrdinal: 4, litCount: 5, surface: 'front' }, ['front'])).toBeCloseTo(1, 6);
    expect(perRunT({ of: 'runIndex' }, { litOrdinal: 2, litCount: 5, surface: 'front' }, ['front'])).toBeCloseTo(0.5, 6);
  });

  it('gives a lone lit run 0 rather than dividing by zero', () => {
    expect(perRunT({ of: 'runIndex' }, { litOrdinal: 0, litCount: 1, surface: 'front' }, ['front'])).toBe(0);
  });

  it('spreads surface across the layers the spec enables', () => {
    const layers = ['front', 'back', 'wall'] as const;
    expect(perRunT({ of: 'surface' }, { litOrdinal: 0, litCount: 9, surface: 'front' }, layers)).toBeCloseTo(0, 6);
    expect(perRunT({ of: 'surface' }, { litOrdinal: 3, litCount: 9, surface: 'back' }, layers)).toBeCloseTo(0.5, 6);
    expect(perRunT({ of: 'surface' }, { litOrdinal: 7, litCount: 9, surface: 'wall' }, layers)).toBeCloseTo(1, 6);
  });

  it('gives a surface the spec does not list 0', () => {
    expect(perRunT({ of: 'surface' }, { litOrdinal: 0, litCount: 4, surface: 'connector' }, ['front'])).toBe(0);
  });

  it('is null for a domain that is not per run', () => {
    expect(perRunT({ of: 'run' }, { litOrdinal: 1, litCount: 4, surface: 'front' }, ['front'])).toBeNull();
    expect(perRunT({ of: 'axis' }, { litOrdinal: 1, litCount: 4, surface: 'front' }, ['front'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/gradient.test.ts`
Expected: FAIL — `perRunT is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `packages/core/src/render/tube/gradient.ts`:

```ts
import type { SurfaceKind } from './surfaces.js';

export type GradientDomain =
  | { of: 'run' }
  | { of: 'letter' }
  | { of: 'runIndex' }
  | { of: 'surface' }
  | { of: 'axis'; angle?: number }
  | { of: 'radial'; at?: [number, number] };

export interface GradientSpec {
  domain: GradientDomain;
  /** Colours the sweep runs through, in order. Two is a fade; more is a ramp. */
  stops: number[];
  /** `replace` paints the ramp; `modulate` multiplies the run's own colour by it. */
  mode: 'replace' | 'modulate';
}

/** What a per-run domain needs to know about the run it is colouring. */
export interface RunPlace {
  /** The run's ordinal among the lit runs. */
  litOrdinal: number;
  litCount: number;
  surface: SurfaceKind;
}

/** Domains whose value is constant within a run. Null for every other domain. */
export function perRunT(
  domain: GradientDomain,
  place: RunPlace,
  surfaces: readonly SurfaceKind[],
): number | null {
  if (domain.of === 'runIndex') {
    return place.litCount <= 1 ? 0 : place.litOrdinal / (place.litCount - 1);
  }
  if (domain.of === 'surface') {
    const i = surfaces.indexOf(place.surface);
    if (i < 0 || surfaces.length <= 1) return 0;
    return i / (surfaces.length - 1);
  }
  return null;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/gradient.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/gradient.ts packages/core/test/render/tube/gradient.test.ts
git commit -m "define the gradient spec and its per-run domains"
```

---

## Task 3: Per-run domains resolve in `assign`

**Files:**
- Modify: `packages/core/src/render/tube/assign.ts`
- Test: `packages/core/test/render/tube/assign.test.ts`

`assign` already deals `run.color` from `colors`. A per-run gradient either replaces that colour with `rampAt(stops, t)` or multiplies it by it. The dealing loop must run first either way — `modulate` needs the dealt colour.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/tube/assign.test.ts`:

```ts
import { rampAt } from '../../../src/render/tube/gradient.js';

describe('assign with a per-run gradient', () => {
  const RAMP = [0xff0000, 0x0000ff];

  it('replaces the dealt colour with the ramp, spread over the lit runs', () => {
    const out = assign(runs(5), { by: 'index', amount: 1 }, COLORS, 3, undefined, ['front'], {
      domain: { of: 'runIndex' },
      stops: RAMP,
      mode: 'replace',
    });
    const lit = out.filter((r) => r.lit);
    expect(lit[0]?.color).toBe(rampAt(RAMP, 0).getHex());
    expect(lit[lit.length - 1]?.color).toBe(rampAt(RAMP, 1).getHex());
  });

  it('multiplies the dealt colour under modulate, so the deck survives', () => {
    const out = assign(runs(5), { by: 'index', amount: 1 }, [0x8040c0], 3, undefined, ['front'], {
      domain: { of: 'runIndex' },
      stops: [0xffffff, 0xffffff],
      mode: 'modulate',
    });
    // A white ramp is the identity: every run keeps the colour it was dealt.
    for (const run of out.filter((r) => r.lit)) expect(run.color).toBe(0x8040c0);
  });

  it('darkens toward the ramp floor under modulate', () => {
    const out = assign(runs(5), { by: 'index', amount: 1 }, [0xffffff], 3, undefined, ['front'], {
      domain: { of: 'runIndex' },
      stops: [0x000000, 0xffffff],
      mode: 'modulate',
    });
    const lit = out.filter((r) => r.lit);
    expect(lit[0]?.color).toBe(0x000000);
    expect(lit[lit.length - 1]?.color).toBe(0xffffff);
  });

  it('leaves a non-per-run domain to the geometry, dealing as usual', () => {
    const out = assign(runs(5), { by: 'index', amount: 1 }, COLORS, 3, undefined, ['front'], {
      domain: { of: 'axis' },
      stops: RAMP,
      mode: 'replace',
    });
    expect(out.filter((r) => r.lit)[0]?.color).toBe(COLORS[0]);
  });

  it('lets surfaceColors win over a surface domain', () => {
    const out = assign(runs(4), { by: 'index', amount: 1 }, COLORS, 3, { front: [0x123456] }, ['front'], {
      domain: { of: 'surface' },
      stops: RAMP,
      mode: 'replace',
    });
    expect(out.filter((r) => r.lit).every((r) => r.color === 0x123456)).toBe(true);
  });

  it('deals exactly as before when no gradient is given', () => {
    const before = assign(runs(7), { by: 'seed', amount: 0.6 }, COLORS, 11);
    const after = assign(runs(7), { by: 'seed', amount: 0.6 }, COLORS, 11, undefined, ['front']);
    expect(after.map((r) => [r.lit, r.color])).toEqual(before.map((r) => [r.lit, r.color]));
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/assign.test.ts`
Expected: FAIL — the new arguments are not in `assign`'s signature, so the gradient is ignored and the ramp assertions miss.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/render/tube/assign.ts`, add the imports:

```ts
import { type GradientSpec, perRunT, rampAt } from './gradient.js';
```

Extend the signature (both new parameters optional, so every existing call site is unchanged):

```ts
export function assign(
  runs: Run[],
  select: SelectSpec,
  colors: number[],
  seed: number,
  surfaceColors?: Partial<Record<SurfaceKind, number[]>>,
  surfaces: readonly SurfaceKind[] = [],
  gradient?: GradientSpec,
): Run[] {
```

Then replace the two `return runs;` statements at the end of the function with `applyPerRunGradient(runs, surfaces, surfaceColors !== undefined, gradient);`, and add this below `assign`:

```ts
/**
 * Per-run domains only. A per-vertex or positional domain returns the runs untouched: its colour
 * is resolved in the sweep or the shader, and the dealt colour is what `modulate` multiplies there.
 */
function applyPerRunGradient(
  runs: Run[],
  surfaces: readonly SurfaceKind[],
  surfaceColorsGiven: boolean,
  gradient?: GradientSpec,
): Run[] {
  if (!gradient) return runs;
  // A per-layer palette names colours directly; the surface domain is the coarser way of asking
  // for the same thing, so it yields rather than overwriting them.
  if (gradient.domain.of === 'surface' && surfaceColorsGiven) return runs;
  const lit = runs.filter((r) => r.lit);
  const scratch = new THREE.Color();
  for (let n = 0; n < lit.length; n++) {
    const run = lit[n] as Run;
    const t = perRunT(gradient.domain, { litOrdinal: n, litCount: lit.length, surface: run.surface }, surfaces);
    if (t === null) return runs;
    const ramp = rampAt(gradient.stops, t);
    if (gradient.mode === 'replace') {
      run.color = ramp.getHex();
    } else {
      scratch.setHex(run.color).multiply(ramp);
      run.color = scratch.getHex();
    }
  }
  return runs;
}
```

Add `import * as THREE from 'three';` at the top of `assign.ts` — it does not import three today.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run packages/core/test/render/tube/assign.test.ts`
Expected: PASS — the pre-existing `assign` tests plus the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/assign.ts packages/core/test/render/tube/assign.test.ts
git commit -m "resolve per-run gradient domains where the run list already is"
```

---

## Task 4: Per-vertex domains write a `gradientT` attribute

**Files:**
- Modify: `packages/core/src/render/tube/gradient.ts`
- Modify: `packages/core/src/render/tube/sweep.ts`
- Test: `packages/core/test/render/tube/gradient.test.ts`, `packages/core/test/render/tube/sweep.test.ts`

`buildTubeGeometry` already writes `uv.x = i / (ringCount - 1)` — the fraction along the run. The `run` domain is that number. The `letter` domain places the run inside the glyph, so it needs where the run starts within the glyph's lit length and how much of it the run spans.

- [ ] **Step 1: Write the failing test for the pure part**

Append to `packages/core/test/render/tube/gradient.test.ts`:

```ts
import { perVertexT } from '../../../src/render/tube/gradient.js';

describe('perVertexT', () => {
  const span = { start: 0.25, span: 0.5 };

  it('runs 0..1 along the run and restarts, for the run domain', () => {
    expect(perVertexT({ of: 'run' }, 0, 5, span)).toBeCloseTo(0, 6);
    expect(perVertexT({ of: 'run' }, 4, 5, span)).toBeCloseTo(1, 6);
    expect(perVertexT({ of: 'run' }, 2, 5, span)).toBeCloseTo(0.5, 6);
  });

  it('places the run inside the glyph, for the letter domain', () => {
    expect(perVertexT({ of: 'letter' }, 0, 5, span)).toBeCloseTo(0.25, 6);
    expect(perVertexT({ of: 'letter' }, 4, 5, span)).toBeCloseTo(0.75, 6);
    expect(perVertexT({ of: 'letter' }, 2, 5, span)).toBeCloseTo(0.5, 6);
  });

  it('gives a one-ring run 0 rather than dividing by zero', () => {
    expect(perVertexT({ of: 'run' }, 0, 1, span)).toBe(0);
  });

  it('is null for a domain that is not per vertex', () => {
    expect(perVertexT({ of: 'runIndex' }, 2, 5, span)).toBeNull();
    expect(perVertexT({ of: 'radial' }, 2, 5, span)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/gradient.test.ts`
Expected: FAIL — `perVertexT is not a function`.

- [ ] **Step 3: Implement `perVertexT`**

Append to `packages/core/src/render/tube/gradient.ts`:

```ts
/** Where a run sits inside its glyph's lit length, as a fraction. */
export interface RunSpan {
  start: number;
  span: number;
}

/** Domains that vary along a run. Null for every other domain. */
export function perVertexT(
  domain: GradientDomain,
  ring: number,
  ringCount: number,
  place: RunSpan,
): number | null {
  if (domain.of !== 'run' && domain.of !== 'letter') return null;
  const along = ringCount <= 1 ? 0 : ring / (ringCount - 1);
  return domain.of === 'run' ? along : place.start + place.span * along;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/gradient.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Write the failing test for the attribute**

Append to `packages/core/test/render/tube/sweep.test.ts`:

```ts
import { GRADIENT_T_ATTRIBUTE } from '../../../src/render/tube/gradient.js';

describe('sweepRun gradientT attribute', () => {
  it('is absent when no gradient is asked for', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.02, 8);
    expect(geo?.getAttribute(GRADIENT_T_ATTRIBUTE)).toBeUndefined();
  });

  it('runs 0..1 along the run under the run domain', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.02, 8, {
      domain: { of: 'run' },
      place: { start: 0, span: 1 },
    });
    const attr = geo?.getAttribute(GRADIENT_T_ATTRIBUTE);
    expect(attr).toBeDefined();
    expect(attr?.itemSize).toBe(1);
    // One value per vertex, and the vertices are ring-major.
    expect(attr?.getX(0)).toBeCloseTo(0, 6);
    expect(attr?.getX((attr?.count ?? 1) - 1)).toBeCloseTo(1, 6);
  });

  it('confines the sweep to the run’s own slice under the letter domain', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.02, 8, {
      domain: { of: 'letter' },
      place: { start: 0.4, span: 0.2 },
    });
    const attr = geo?.getAttribute(GRADIENT_T_ATTRIBUTE);
    expect(attr?.getX(0)).toBeCloseTo(0.4, 6);
    expect(attr?.getX((attr?.count ?? 1) - 1)).toBeCloseTo(0.6, 6);
  });

  it('is absent for a positional domain, which the shader resolves', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.02, 8, {
      domain: { of: 'axis' },
      place: { start: 0, span: 1 },
    });
    expect(geo?.getAttribute(GRADIENT_T_ATTRIBUTE)).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run the test and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/sweep.test.ts`
Expected: FAIL — `sweepRun` takes three arguments, and `GRADIENT_T_ATTRIBUTE` is not exported.

- [ ] **Step 7: Implement the attribute**

Add to `packages/core/src/render/tube/gradient.ts`:

```ts
export const GRADIENT_T_ATTRIBUTE = 'gradientT';
```

In `packages/core/src/render/tube/sweep.ts`, add to the imports:

```ts
import { type GradientDomain, GRADIENT_T_ATTRIBUTE, perVertexT, type RunSpan } from './gradient.js';
```

Add this interface above `buildTubeGeometry`:

```ts
/** The gradient's placement for one run, when the domain is resolved per vertex. */
export interface GradientPlace {
  domain: GradientDomain;
  place: RunSpan;
}
```

Give `buildTubeGeometry` a fifth parameter `gradient?: GradientPlace`, and inside it declare the buffer beside `colors`:

```ts
  const ts: number[] = [];
```

In the ring loop, right after `uvs.push(i / (ringCount - 1), j / segments);`, add:

```ts
      if (gradient) {
        const t = perVertexT(gradient.domain, i, ringCount, gradient.place);
        if (t !== null) ts.push(t);
      }
```

And after `geo.setAttribute(RUN_COLOR_ATTRIBUTE, ...)`:

```ts
  if (ts.length > 0) {
    geo.setAttribute(GRADIENT_T_ATTRIBUTE, new THREE.Float32BufferAttribute(ts, 1));
  }
```

Finally widen `sweepRun`:

```ts
export function sweepRun(
  run: Run,
  requested: number,
  segments: number,
  gradient?: GradientPlace,
): THREE.BufferGeometry | null {
  if (run.points.length < 2 || requested <= 0) return null;
  return buildTubeGeometry(smoothedPoints(run), requested, segments, run.color, gradient);
}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `npx vitest run packages/core/test/render/tube/sweep.test.ts`
Expected: PASS — the pre-existing sweep tests plus the 4 new ones.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/render/tube/gradient.ts packages/core/src/render/tube/sweep.ts packages/core/test/render/tube/gradient.test.ts packages/core/test/render/tube/sweep.test.ts
git commit -m "write a per-vertex gradient parameter alongside the run colour"
```

---

> **Correction, applied after Task 5 measured it.** `perVertexT` takes an arc-length fraction,
> not `(ring, ringCount)`: `perVertexT(domain, along, place)`. `ringsOf` adds 4 cap rings at each
> end covering only ~`radius` of length, so a ring-index parameter raced through the domes — a
> 25-point run spent 25% of its range on caps that are 11% of its length, and the share moved with
> point density. `buildTubeGeometry` now accumulates centre-to-centre distance and normalises.
> The steps below describe the superseded signature; the committed code is the corrected one.

## Task 5: `TubeSpec.gradient`, and the glyph's lit spans

**Files:**
- Modify: `packages/core/src/render/tube/index.ts`
- Test: `packages/core/test/render/tube/index.test.ts`

The `letter` domain needs each run's slice of the glyph's lit length. `buildTubeBlueprint` is the one place that has the glyph's whole run list, so it computes the spans and hands each to `sweepRun`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/tube/index.test.ts`:

```ts
import { GRADIENT_T_ATTRIBUTE } from '../../../src/render/tube/gradient.js';

describe('buildTubeBlueprint with a gradient', () => {
  it('leaves the geometry free of a gradient attribute when none is asked for', () => {
    const bp = buildTubeBlueprint(shapesFor('J'), SPEC, 0.3, 0);
    for (const geo of bp.lit) expect(geo.getAttribute(GRADIENT_T_ATTRIBUTE)).toBeUndefined();
    bp.dispose();
  });

  it('spans the whole glyph exactly once under the letter domain', () => {
    const bp = buildTubeBlueprint(
      { ...SPEC, gradient: { domain: { of: 'letter' }, stops: [0xff0000, 0x0000ff], mode: 'replace' } },
      0.3,
      0,
    );
    const values = bp.lit.flatMap((geo) => {
      const attr = geo.getAttribute(GRADIENT_T_ATTRIBUTE);
      return Array.from({ length: attr.count }, (_, i) => attr.getX(i));
    });
    expect(Math.min(...values)).toBeCloseTo(0, 3);
    expect(Math.max(...values)).toBeCloseTo(1, 3);
    bp.dispose();
  });

  it('restarts on every run under the run domain', () => {
    const bp = buildTubeBlueprint(
      { ...SPEC, gradient: { domain: { of: 'run' }, stops: [0xff0000, 0x0000ff], mode: 'replace' } },
      0.3,
      0,
    );
    for (const geo of bp.lit) {
      const attr = geo.getAttribute(GRADIENT_T_ATTRIBUTE);
      expect(attr.getX(0)).toBeCloseTo(0, 6);
      expect(attr.getX(attr.count - 1)).toBeCloseTo(1, 6);
    }
    bp.dispose();
  });
});
```

Note: the second and third cases pass the spec as the first argument only if `index.test.ts` already has a helper of that shape. Check the file's existing `buildTubeBlueprint` calls and match them — the existing tests construct `shapesFor(...)` and a `SPEC` constant; reuse both, passing `shapesFor('J')` as the first argument and the spread spec as the second.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/index.test.ts`
Expected: FAIL — `gradient` is not a property of `TubeSpec`, so tsc errors and the attribute is never written.

- [ ] **Step 3: Add the field and thread it**

In `packages/core/src/render/tube/index.ts`, add to the imports:

```ts
import type { GradientSpec } from './gradient.js';
```

Re-export the public types beside the others:

```ts
export type { GradientDomain, GradientSpec } from './gradient.js';
```

Add the field to `TubeSpec`, after `surfaceColors`:

```ts
  /** A colour sweep across the sign. Omit for a flat colour per run, which is the default. */
  gradient?: GradientSpec;
```

Pass the surfaces and the gradient to `assign`:

```ts
  const runs = assign(
    cut.runs,
    spec.select,
    spec.colors,
    seed,
    spec.surfaceColors,
    spec.surfaces,
    spec.gradient,
  );
```

Replace the sweep loop with one that computes each lit run's span first:

```ts
  // The letter domain needs each run's slice of the glyph's lit length, and this is the only
  // place that has the glyph's whole run list.
  const litRuns = runs.filter((r) => r.lit);
  const litTotal = litRuns.reduce((a, r) => a + r.length, 0);
  const spans = new Map<number, { start: number; span: number }>();
  let walked = 0;
  for (const run of litRuns) {
    spans.set(run.index, {
      start: litTotal > 0 ? walked / litTotal : 0,
      span: litTotal > 0 ? run.length / litTotal : 0,
    });
    walked += run.length;
  }

  const lit: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  for (const run of runs) {
    const place = spec.gradient && run.lit ? spans.get(run.index) : undefined;
    const geo = sweepRun(
      run,
      spec.radius,
      spec.segments,
      spec.gradient && place ? { domain: spec.gradient.domain, place } : undefined,
    );
    if (!geo) continue;
    (run.lit ? lit : dark).push(geo);
  }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run packages/core/test/render/tube/index.test.ts`
Expected: PASS — the pre-existing blueprint tests plus the 3 new ones.

- [ ] **Step 5: Run the whole unit suite**

Run: `npm run test`
Expected: PASS, 638 pre-existing tests plus the new ones, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/index.ts packages/core/test/render/tube/index.test.ts
git commit -m "add TubeSpec.gradient and place each run inside its glyph"
```

---

## Task 6: Positional domains in the shader

**Files:**
- Modify: `packages/core/src/render/tube/gradient.ts`
- Modify: `packages/core/src/render/tube/tint.ts`
- Test: `packages/core/test/render/tube/gradient.test.ts`

`tintByRunColor` patches the material's shader today to multiply a channel by the per-vertex `runColor`. It grows a ramp: `t` comes from the `gradientT` attribute for the per-vertex tier, or is computed from position for the positional tier, and indexes a 256×1 `DataTexture` baked by `rampAt` — so the GPU ramp *is* the CPU ramp, sampled.

Positional `t` is computed against the **letter-placement space**, not world space: `position.xy + uGradOrigin`, where `uGradOrigin` is the letter's own offset in the word. That deliberately excludes the group's fit transform, so a resize cannot move the gradient.

- [ ] **Step 1: Write the failing test for the ramp texture**

Append to `packages/core/test/render/tube/gradient.test.ts`:

```ts
import { RAMP_RESOLUTION, rampTexture } from '../../../src/render/tube/gradient.js';

describe('rampTexture', () => {
  it('is a 256x1 float texture', () => {
    const tex = rampTexture([0xff0000, 0x0000ff]);
    expect(tex.image.width).toBe(RAMP_RESOLUTION);
    expect(tex.image.height).toBe(1);
    expect(tex.image.data).toHaveLength(RAMP_RESOLUTION * 4);
    tex.dispose();
  });

  it('is the CPU ramp sampled, so the two cannot drift', () => {
    const stops = [0xff2d95, 0xffd14a, 0x2de0ff];
    const tex = rampTexture(stops);
    const data = tex.image.data as Float32Array;
    for (const i of [0, 1, 77, 128, 254, 255]) {
      const want = rampAt(stops, i / (RAMP_RESOLUTION - 1));
      expect(data[i * 4]).toBeCloseTo(want.r, 5);
      expect(data[i * 4 + 1]).toBeCloseTo(want.g, 5);
      expect(data[i * 4 + 2]).toBeCloseTo(want.b, 5);
      expect(data[i * 4 + 3]).toBe(1);
    }
    tex.dispose();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/gradient.test.ts`
Expected: FAIL — `rampTexture is not a function`.

- [ ] **Step 3: Implement the ramp texture**

Append to `packages/core/src/render/tube/gradient.ts`:

```ts
export const RAMP_RESOLUTION = 256;

/**
 * The ramp as a texture the shader can index by `t`. Built by sampling `rampAt`, so a positional
 * domain and a per-run one resolve the same stops to the same colours.
 */
export function rampTexture(stops: readonly number[]): THREE.DataTexture {
  const data = new Float32Array(RAMP_RESOLUTION * 4);
  for (let i = 0; i < RAMP_RESOLUTION; i++) {
    const c = rampAt(stops, i / (RAMP_RESOLUTION - 1));
    data[i * 4] = c.r;
    data[i * 4 + 1] = c.g;
    data[i * 4 + 2] = c.b;
    data[i * 4 + 3] = 1;
  }
  const tex = new THREE.DataTexture(data, RAMP_RESOLUTION, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // Already linear: rampAt returns three's working space, so a colour-space conversion would
  // apply the sRGB transfer function a second time.
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/gradient.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Write the failing test for the shader patch**

Append to `packages/core/test/render/tube/gradient.test.ts`:

```ts
import { tintByRunColor } from '../../../src/render/tube/tint.js';

/** Runs the material's onBeforeCompile against a stand-in shader and returns what it produced. */
function compiled(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <begin_vertex>\n',
    fragmentShader: '#include <emissivemap_fragment>\n#include <color_fragment>\n',
  };
  material.onBeforeCompile?.(shader as never, undefined as never);
  return shader;
}

describe('tintByRunColor with a gradient', () => {
  it('reads the attribute for a per-vertex domain', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain: { of: 'run' }, stops: [0xff0000, 0x0000ff], mode: 'replace' });
    const s = compiled(m);
    expect(s.vertexShader).toContain('attribute float gradientT');
    expect(s.vertexShader).not.toContain('uGradBounds');
    expect(s.fragmentShader).toContain('uGradRamp');
  });

  it('computes t from position for a positional domain', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain: { of: 'axis', angle: 90 }, stops: [0xff0000, 0x0000ff], mode: 'replace' });
    const s = compiled(m);
    expect(s.vertexShader).toContain('uGradBounds');
    expect(s.vertexShader).toContain('uGradOrigin');
    expect(s.vertexShader).not.toContain('attribute float gradientT');
    expect(s.uniforms.uGradBounds).toBeDefined();
    expect(s.uniforms.uGradOrigin).toBeDefined();
    expect(s.uniforms.uGradRamp).toBeDefined();
  });

  it('multiplies rather than replaces under modulate', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive', { domain: { of: 'run' }, stops: [0xffffff], mode: 'modulate' });
    expect(compiled(m).fragmentShader).toContain('vRunColor * ');
  });

  it('keeps a different domain on a different compiled program', () => {
    const a = new THREE.MeshPhysicalMaterial();
    const b = new THREE.MeshPhysicalMaterial();
    tintByRunColor(a, 'emissive', { domain: { of: 'run' }, stops: [0xff0000], mode: 'replace' });
    tintByRunColor(b, 'emissive', { domain: { of: 'axis' }, stops: [0xff0000], mode: 'replace' });
    expect(a.customProgramCacheKey?.()).not.toBe(b.customProgramCacheKey?.());
  });

  it('is unchanged when no gradient is given', () => {
    const m = new THREE.MeshPhysicalMaterial();
    tintByRunColor(m, 'emissive');
    const s = compiled(m);
    expect(s.fragmentShader).toContain('totalEmissiveRadiance *= vRunColor;');
    expect(s.fragmentShader).not.toContain('uGradRamp');
  });
});
```

- [ ] **Step 6: Run the test and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/gradient.test.ts`
Expected: FAIL — `tintByRunColor` takes two arguments.

- [ ] **Step 7: Implement the shader patch**

Rewrite `tintByRunColor` in `packages/core/src/render/tube/tint.ts`:

```ts
import {
  GRADIENT_T_ATTRIBUTE,
  type GradientSpec,
  rampTexture,
} from './gradient.js';

/** Uniform names the word stage sets per letter. */
export const GRADIENT_BOUNDS_UNIFORM = 'uGradBounds';
export const GRADIENT_ORIGIN_UNIFORM = 'uGradOrigin';

function positional(gradient: GradientSpec): boolean {
  return gradient.domain.of === 'axis' || gradient.domain.of === 'radial';
}

/** GLSL computing `gt` in the letter-placement space, for a positional domain. */
function positionalT(gradient: GradientSpec): string {
  const d = gradient.domain;
  if (d.of === 'radial') {
    const [ax, ay] = d.at ?? [0.5, 0.5];
    return `
  vec2 gp = position.xy + ${GRADIENT_ORIGIN_UNIFORM};
  vec2 lo = ${GRADIENT_BOUNDS_UNIFORM}.xy, hi = ${GRADIENT_BOUNDS_UNIFORM}.zw;
  vec2 at = mix(lo, hi, vec2(${ax.toFixed(6)}, ${ay.toFixed(6)}));
  float far = max(max(distance(at, lo), distance(at, hi)),
                  max(distance(at, vec2(lo.x, hi.y)), distance(at, vec2(hi.x, lo.y))));
  gt = far > 0.0 ? distance(gp, at) / far : 0.0;`;
  }
  const a = (((d.of === 'axis' ? (d.angle ?? 0) : 0) * Math.PI) / 180).toFixed(6);
  return `
  vec2 gp = position.xy + ${GRADIENT_ORIGIN_UNIFORM};
  vec2 lo = ${GRADIENT_BOUNDS_UNIFORM}.xy, hi = ${GRADIENT_BOUNDS_UNIFORM}.zw;
  vec2 dir = vec2(cos(${a}), sin(${a}));
  float p0 = dot(lo, dir), p1 = dot(hi, dir);
  float p2 = dot(vec2(lo.x, hi.y), dir), p3 = dot(vec2(hi.x, lo.y), dir);
  float plo = min(min(p0, p1), min(p2, p3));
  float phi = max(max(p0, p1), max(p2, p3));
  gt = phi > plo ? (dot(gp, dir) - plo) / (phi - plo) : 0.0;`;
}

/**
 * Drives `channel` from the per-vertex run colour instead of the material's own, optionally swept
 * by a gradient.
 *
 * Not `vertexColors`, which always modulates diffuse and so cannot reach an emissive look. The
 * material's own channel is set to white so the modulation is exact rather than compounding.
 */
export function tintByRunColor(
  material: THREE.Material,
  channel: TintChannel,
  gradient?: GradientSpec,
): void {
  const target = material as THREE.MeshPhysicalMaterial;
  if (channel === 'emissive') target.emissive = new THREE.Color(0xffffff);
  else target.color = new THREE.Color(0xffffff);

  const ramp = gradient ? rampTexture(gradient.stops) : null;
  const pos = gradient ? positional(gradient) : false;
  const anchor = channel === 'emissive' ? '#include <emissivemap_fragment>' : '#include <color_fragment>';
  const write =
    channel === 'emissive' ? 'totalEmissiveRadiance *=' : 'diffuseColor.rgb *=';

  material.onBeforeCompile = (shader) => {
    const head = [`attribute vec3 ${RUN_COLOR_ATTRIBUTE};`, 'varying vec3 vRunColor;'];
    let body = `#include <begin_vertex>\n  vRunColor = ${RUN_COLOR_ATTRIBUTE};`;

    if (gradient) {
      head.push('varying float vGradT;');
      if (pos) {
        head.push(`uniform vec4 ${GRADIENT_BOUNDS_UNIFORM};`, `uniform vec2 ${GRADIENT_ORIGIN_UNIFORM};`);
        body += `\n  float gt;${positionalT(gradient)}\n  vGradT = clamp(gt, 0.0, 1.0);`;
        shader.uniforms[GRADIENT_BOUNDS_UNIFORM] = { value: new THREE.Vector4(0, 0, 1, 1) };
        shader.uniforms[GRADIENT_ORIGIN_UNIFORM] = { value: new THREE.Vector2(0, 0) };
      } else {
        head.push(`attribute float ${GRADIENT_T_ATTRIBUTE};`);
        body += `\n  vGradT = clamp(${GRADIENT_T_ATTRIBUTE}, 0.0, 1.0);`;
      }
      shader.uniforms.uGradRamp = { value: ramp };
    }

    shader.vertexShader = `${head.join('\n')}\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      body,
    );

    const fragHead = gradient
      ? 'varying vec3 vRunColor;\nvarying float vGradT;\nuniform sampler2D uGradRamp;\n'
      : 'varying vec3 vRunColor;\n';
    const tinted = !gradient
      ? 'vRunColor'
      : gradient.mode === 'modulate'
        ? 'vRunColor * texture2D(uGradRamp, vec2(vGradT, 0.5)).rgb'
        : 'texture2D(uGradRamp, vec2(vGradT, 0.5)).rgb';

    shader.fragmentShader = `${fragHead}${shader.fragmentShader}`.replace(
      anchor,
      `${anchor}\n  ${write} ${tinted};`,
    );
  };

  // Two materials patched differently must not share a compiled program.
  const key = gradient ? `${gradient.domain.of}-${gradient.mode}` : 'flat';
  material.customProgramCacheKey = () => `klieg-run-${channel}-${key}`;
  material.needsUpdate = true;
}
```

Note the `!gradient` branch still emits `totalEmissiveRadiance *= vRunColor;` — byte-identical to today's patch, which is what keeps the baselines still.

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `npx vitest run packages/core/test/render/tube/gradient.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/render/tube/gradient.ts packages/core/src/render/tube/tint.ts packages/core/test/render/tube/gradient.test.ts
git commit -m "sample the ramp in the shader and compute positional domains there"
```

---

## Task 7: The word sets the bounds

**Files:**
- Modify: `packages/core/src/render/word.ts`

`tintByRunColor` is called at `word.ts:241`. It needs the gradient, and a positional domain needs two uniforms per letter: the letter's offset in the word, and the word's bounds in that same space.

The bounds have to be known before any material is built, and they come from the blueprints — which are built per letter in the same loop. So the loop stays as it is and the uniforms are filled in a second pass, once every letter exists.

- [ ] **Step 1: Pass the gradient into the tint**

At `word.ts:241`, change:

```ts
      if (!litOverride) tintByRunColor(decorMaterial, tintChannelOf(decoration.look));
```

to:

```ts
      if (!litOverride) {
        tintByRunColor(decorMaterial, tintChannelOf(decoration.look), decoration.gradient);
      }
```

- [ ] **Step 2: Record each letter's blueprint bounds**

The loop already pushes to `this.tubeBlueprints`. Add a parallel field beside it:

```ts
  /** Per-letter run bounds in the letter's own 1 em space; null where the glyph drew nothing. */
  private readonly tubeBounds: (THREE.Box2 | null)[] = [];
```

and, immediately after `this.tubeBlueprints.push(blueprint);`:

```ts
      const box = new THREE.Box2();
      for (const run of blueprint.runs) {
        for (const p of run.points) box.expandByPoint(new THREE.Vector2(p.x, p.y));
      }
      this.tubeBounds.push(box.isEmpty() ? null : box);
```

Push `null` in the two branches that do not build a tube blueprint, so the array stays indexed by letter slot.

- [ ] **Step 3: Fill the uniforms once every letter exists**

Add this method, and call it from the constructor immediately after the per-letter loop finishes and before `this.applyFit(this.fit)`:

```ts
  /**
   * Positional gradients are defined in the letter-placement space — a letter's own coordinates
   * plus its offset in the word — deliberately excluding the group's fit transform, so a resize
   * cannot slide the sweep across the sign.
   */
  private setGradientBounds(): void {
    const word = new THREE.Box2();
    for (let i = 0; i < this.tubeBounds.length; i++) {
      const box = this.tubeBounds[i];
      if (!box) continue;
      const dx = this.baseX[i] as number;
      const dy = this.baseY[i] as number;
      word.expandByPoint(new THREE.Vector2(box.min.x + dx, box.min.y + dy));
      word.expandByPoint(new THREE.Vector2(box.max.x + dx, box.max.y + dy));
    }
    if (word.isEmpty()) return;

    for (let i = 0; i < this.decorMaterials.length; i++) {
      const material = this.decorMaterials[i];
      if (!material) continue;
      material.userData[GRADIENT_BOUNDS_UNIFORM] = new THREE.Vector4(
        word.min.x,
        word.min.y,
        word.max.x,
        word.max.y,
      );
      material.userData[GRADIENT_ORIGIN_UNIFORM] = new THREE.Vector2(
        this.baseX[i] as number,
        this.baseY[i] as number,
      );
    }
  }
```

- [ ] **Step 4: Have the shader patch read them**

`onBeforeCompile` runs at first render, after `setGradientBounds`, so the patch can read the values off `userData` instead of the word writing into `shader.uniforms` it does not hold. In `tint.ts`, change the two positional uniform initialisers to:

```ts
        shader.uniforms[GRADIENT_BOUNDS_UNIFORM] = {
          value: (material.userData[GRADIENT_BOUNDS_UNIFORM] as THREE.Vector4 | undefined) ??
            new THREE.Vector4(0, 0, 1, 1),
        };
        shader.uniforms[GRADIENT_ORIGIN_UNIFORM] = {
          value: (material.userData[GRADIENT_ORIGIN_UNIFORM] as THREE.Vector2 | undefined) ??
            new THREE.Vector2(0, 0),
        };
```

Import the two uniform names into `word.ts`:

```ts
import { GRADIENT_BOUNDS_UNIFORM, GRADIENT_ORIGIN_UNIFORM, tintByRunColor, tintChannelOf } from './tube/tint.js';
```

- [ ] **Step 5: Typecheck and run the unit suite**

Run: `npm run typecheck && npm run test`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/src/render/tube/tint.ts
git commit -m "give a positional gradient the word's bounds and each letter's offset"
```

---

## Task 8: The baselines must not move

**Files:** none — this is the acceptance gate for everything above.

No shipped look sets `gradient`, so every published render must be identical. This is the same claim the run-colour work made.

- [ ] **Step 1: Run the visual suite**

Run: `npx playwright test`
Expected: PASS, 24 tests, no snapshot diffs.

- [ ] **Step 2: If any baseline moved, do not update it**

A moved baseline means the `gradient`-absent path is no longer byte-identical — almost certainly the shader patch in Task 6 emitting different GLSL than today's. Diff the produced fragment shader against `git show HEAD~3:packages/core/src/render/tube/tint.ts` and fix the patch. Updating a snapshot here would discard the only check that published looks did not move.

- [ ] **Step 3: Commit nothing**

Nothing to commit — this task is a gate, not a change.

---

## Task 9: The lab drives it

**Files:**
- Modify: `packages/core/dev/tube-lab/src/Rail.tsx`

Every rail control carries a hover hint saying what it does and what it interacts with badly. Match that.

- [ ] **Step 1: Add the controls**

Add a gradient section to the rail, using the existing `Select`, `Slider` and `Color` components in `Rail.tsx`. It needs:

- a domain select over `off`, `run`, `letter`, `runIndex`, `surface`, `axis`, `radial`
- a mode select over `replace`, `modulate`, disabled when the domain is `off`
- an angle slider, 0–360 in degrees, shown only for `axis`
- three colour inputs for the stops, with a stop-count slider of 1–3

Hints to use verbatim:

| control | hint |
|---|---|
| domain | "What the sweep is a function of. `surface` does nothing under a look with one layer, which is both shipped looks." |
| mode | "`replace` paints the ramp over the palette; `modulate` multiplies the palette by it, so a multi-colour sign keeps its colours." |
| angle | "Direction of the sweep across the word. 0 is left to right." |
| stops | "Colours the sweep runs through. Under `modulate` these are multipliers: a stop below #555 reads as a dead tube rather than a shaded one." |

- [ ] **Step 2: Check it against the spike**

Run: `npm run build -w klieg && node spikes/gradient-presets.mjs JACKPOT > /tmp/presets.html && open /tmp/presets.html`

Then run the lab with `npm run dev:tube-lab -w klieg` and reproduce `electrode` (`run` / `replace` / `#8a1250 #ff5cb0 #8a1250`) and `wash` (`axis 0°` / `modulate` / `#555555 #ffffff`). The lab and the spike should agree on which end of the word is which colour.

- [ ] **Step 3: Run the full check**

Run: `npm run check`
Expected: lint clean, tsc clean, all unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/dev/tube-lab/src/Rail.tsx
git commit -m "give the rail a gradient domain, mode and stops"
```

---

## Task 10: Document it

**Files:**
- Modify: `docs/superpowers/HANDOFF.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Update the handoff**

Replace the "A colour fade along a run is now cheap and unbuilt" paragraph with what shipped: the three tiers, that positional domains are defined in the letter-placement space so a re-fit cannot move them, and that `spikes/gradient-presets.mjs` is where stops get tuned. Remove the colour-fade bullet from "What is worth doing next".

- [ ] **Step 2: Add the public API to the README**

`TubeSpec.gradient` is public API and the README documents `TubeSpec`. Add the field with the domain list, the two modes, and one worked example — `electrode`, since it is the one that argues for the feature.

- [ ] **Step 3: Add a CHANGELOG entry**

Match the file's existing format.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/HANDOFF.md CHANGELOG.md README.md
git commit -m "document the gradient field and what each domain sweeps"
```

---

## Self-review

**Spec coverage.** Every section of the design maps to a task: the field and the three tiers (Tasks 3–6), each domain's `t` (Tasks 2, 4, 6), linear-space stops (Task 1), the cap clamp (Task 6, `clamp` in the vertex patch), lit-runs-only (Task 3, the loop walks `r.lit`), `surfaceColors` winning over a `surface` domain (Task 3), the ramp floor (Task 9's hint), acceptance (Task 8), presets (already committed as `spikes/gradient-presets.mjs`).

**One gap found and closed:** `surfaceColors` winning over a `surface` domain had no task; it is now the guard and the test in Task 3.

**Placeholders:** none — every code step carries its code, and Task 9's controls are specified by the component to use, the range, and the hint text.

**Type consistency:** `GradientSpec`, `GradientDomain`, `RunPlace`, `RunSpan`, `GradientPlace`, `perRunT`, `perVertexT`, `rampAt`, `rampTexture`, `GRADIENT_T_ATTRIBUTE`, `GRADIENT_BOUNDS_UNIFORM`, `GRADIENT_ORIGIN_UNIFORM` are each defined once and used with the same signature throughout. `sweepRun`'s fourth parameter is `GradientPlace` in both Task 4 and Task 5.
