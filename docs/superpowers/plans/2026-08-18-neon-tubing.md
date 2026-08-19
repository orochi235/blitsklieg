# Neon Tubing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `tubing`'s outline trace with runs of glass tube generated across the three surfaces of an extruded glyph.

**Architecture:** Five stages, each a module that depends only on the one above it. A signed distance field over the flattened glyph silhouette yields 2D paths; surface coordinate maps lift them to 3D polylines; cutting turns polylines into an addressable run list; assignment decides which runs light and in what color; sweeping turns lit runs into tube geometry. The run list is the public seam between generation and consumption.

**Tech Stack:** TypeScript, three.js, vitest (no WebGL in tests), Playwright for visual baselines, biome for lint/format.

**Spec:** `docs/superpowers/specs/2026-08-18-neon-tubing-design.md`
**Reference implementation:** `spikes/tube-paths.mjs` — the field, resampling and curvature arithmetic already work there and should be ported, not reinvented.

---

## File Structure

New modules live under `packages/core/src/render/tube/`. The existing `render/` directory is flat, but `decoration.ts` is already 358 lines carrying two generators, and this spec adds five stages — a subdirectory keeps each stage in a file small enough to hold in context.

| File | Responsibility |
|---|---|
| `tube/field.ts` | Rasterise a silhouette, exact Euclidean distance transform, marching-squares isocontours |
| `tube/resample.ts` | Arc-length resampling, smoothing, curvature measurement |
| `tube/surfaces.ts` | Front/back/wall coordinate maps and their inverses to 3D |
| `tube/generators.ts` | Face, wall and connector generators — 2D paths in, 3D polylines out |
| `tube/runs.ts` | Live-curve filtering, corner detection, cutting, the `Run` type |
| `tube/assign.ts` | Selection ordering/amount, color cycling |
| `tube/sweep.ts` | Runs to `BufferGeometry`, with radius tapered against curvature |
| `tube/index.ts` | `buildTubeBlueprint` — ties the stages together |

Modified: `render/decoration.ts` (TubeSpec replaced, tube code removed), `render/looks.ts` (`tubing` preset), `render/word.ts` (dark material for unlit runs), `apps/lab/index.html` + `apps/lab/src/main.ts` (sliders), `packages/core/src/index.ts` (exports).

---

### Task 1: Distance field

**Files:**
- Create: `packages/core/src/render/tube/field.ts`
- Test: `packages/core/test/render/tube/field.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { isoContours, signedDistanceField } from '../../../src/render/tube/field.js';

/** A 1x1 square centred on the origin, as a closed polygon. */
function square(): { x: number; y: number }[] {
  return [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 },
  ];
}

describe('signedDistanceField', () => {
  it('is negative inside and positive outside', () => {
    const f = signedDistanceField([square()], { resolution: 128, pad: 0.4 });
    expect(f.sample(0, 0)).toBeLessThan(0);
    expect(f.sample(0.9, 0.9)).toBeGreaterThan(0);
  });

  it('reports the distance to the edge, not to the cell class', () => {
    // The centre of a 1x1 square is 0.5 from every edge. A field seeded on the wrong side
    // collapses to zero everywhere, which is the failure this pins.
    const f = signedDistanceField([square()], { resolution: 256, pad: 0.4 });
    expect(f.sample(0, 0)).toBeCloseTo(-0.5, 1);
  });
});

describe('isoContours', () => {
  it('returns one closed loop for the outline of a square', () => {
    const f = signedDistanceField([square()], { resolution: 256, pad: 0.4 });
    const lines = isoContours(f, 0);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.length).toBeGreaterThan(8);
  });

  it('empties out once the level exceeds the shape half-width', () => {
    const f = signedDistanceField([square()], { resolution: 256, pad: 0.4 });
    expect(isoContours(f, -0.4).length).toBe(1);
    expect(isoContours(f, -0.6).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/field.test.ts`
Expected: FAIL — `Failed to resolve import ".../tube/field.js"`

- [ ] **Step 3: Write the implementation**

Port from `spikes/tube-paths.mjs`. Two details in that file are load-bearing and were bugs before they were fixed: the `FAR` sentinel (an `Infinity` seed makes the parabola intersection compute `Infinity - Infinity = NaN` and voids the exterior field), and the pairing of each transform with the *opposite* side.

```ts
export interface Point2 {
  x: number;
  y: number;
}

export interface Field {
  readonly data: Float64Array;
  readonly size: number;
  readonly emPerCell: number;
  readonly originX: number;
  readonly originY: number;
  sample(x: number, y: number): number;
}

export interface FieldOptions {
  /** Grid cells per side. */
  resolution: number;
  /** Margin around the silhouette in em, so exterior levels have room to exist. */
  pad: number;
}

/** Larger than any squared distance on the grid, but finite. Infinity yields NaN below. */
const FAR = 1e20;

/** Felzenszwalb & Huttenlocher exact squared-EDT, one dimension. */
function edt1d(f: Float64Array, n: number): Float64Array {
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = Number.NEGATIVE_INFINITY;
  z[1] = Number.POSITIVE_INFINITY;

  for (let q = 1; q < n; q++) {
    const fq = f[q] as number;
    let s = (fq + q * q - ((f[v[k] as number] as number) + (v[k] as number) ** 2)) /
      (2 * q - 2 * (v[k] as number));
    while (s <= (z[k] as number)) {
      k--;
      s = (fq + q * q - ((f[v[k] as number] as number) + (v[k] as number) ** 2)) /
        (2 * q - 2 * (v[k] as number));
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Number.POSITIVE_INFINITY;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] as number) < q) k++;
    const vk = v[k] as number;
    d[q] = (q - vk) ** 2 + (f[vk] as number);
  }
  return d;
}

/** Exact squared distance from every cell to the nearest zero cell of `mask`. */
function edt2d(mask: Uint8Array, size: number): Float64Array {
  const f = new Float64Array(size);
  const d = new Float64Array(size * size);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) f[y] = (mask[y * size + x] as number) ? FAR : 0;
    const col = edt1d(f, size);
    for (let y = 0; y < size; y++) d[y * size + x] = col[y] as number;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) f[x] = d[y * size + x] as number;
    const row = edt1d(f, size);
    for (let x = 0; x < size; x++) d[y * size + x] = row[x] as number;
  }
  return d;
}

function rasterise(
  polygons: Point2[][],
  size: number,
  toGrid: (p: Point2) => Point2,
): Uint8Array {
  const mask = new Uint8Array(size * size);
  const grid = polygons.map((poly) => poly.map(toGrid));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = false;
      for (const poly of grid) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[i] as Point2;
          const b = poly[j] as Point2;
          if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
          }
        }
      }
      mask[y * size + x] = inside ? 1 : 0;
    }
  }
  return mask;
}

export function signedDistanceField(polygons: Point2[][], opts: FieldOptions): Field {
  const { resolution: size, pad } = opts;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const poly of polygons) {
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const span = Math.max(maxX - minX, maxY - minY);
  const scale = (size - 1) / span;
  const toGrid = (p: Point2) => ({ x: (p.x - minX) * scale, y: (p.y - minY) * scale });
  const emPerCell = 1 / scale;

  const mask = rasterise(polygons, size, toGrid);
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = (mask[i] as number) ? 0 : 1;

  // Each transform is only meaningful on the far side of the boundary: edt2d(mask) measures an
  // inside cell's distance to background, edt2d(inv) an outside cell's distance to the solid.
  // Pairing them the other way collapses the whole field to zero.
  const toBackground = edt2d(mask, size);
  const toSolid = edt2d(inv, size);
  const data = new Float64Array(size * size);
  for (let i = 0; i < data.length; i++) {
    data[i] =
      ((mask[i] as number)
        ? -Math.sqrt(toBackground[i] as number)
        : Math.sqrt(toSolid[i] as number)) * emPerCell;
  }

  return {
    data,
    size,
    emPerCell,
    originX: minX,
    originY: minY,
    sample(x, y) {
      const gx = Math.round((x - minX) * scale);
      const gy = Math.round((y - minY) * scale);
      if (gx < 0 || gy < 0 || gx >= size || gy >= size) return Number.POSITIVE_INFINITY;
      return data[gy * size + gx] as number;
    },
  };
}

/**
 * Marching squares at `level`, stitched into closed polylines in em coordinates. Segment
 * orientation is not consistent, so the join indexes both endpoints and walks either way.
 */
export function isoContours(field: Field, level: number): Point2[][] {
  const { data, size, emPerCell, originX, originY } = field;
  const at = (x: number, y: number) => data[y * size + x] as number;
  const segs: [Point2, Point2][] = [];

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)];
      const c = [
        { x, y },
        { x: x + 1, y },
        { x: x + 1, y: y + 1 },
        { x, y: y + 1 },
      ];
      let idx = 0;
      for (let i = 0; i < 4; i++) if ((v[i] as number) < level) idx |= 1 << i;
      if (idx === 0 || idx === 15) continue;

      const e: Point2[] = [];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        if ((v[i] as number) < level !== ((v[j] as number) < level)) {
          const a = v[i] as number;
          const b = v[j] as number;
          const t = (level - a) / (b - a || 1e-9);
          const p = c[i] as Point2;
          const q = c[j] as Point2;
          e.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        }
      }
      for (let i = 0; i + 1 < e.length; i += 2) {
        segs.push([e[i] as Point2, e[i + 1] as Point2]);
      }
    }
  }

  const key = (p: Point2) => `${Math.round(p.x * 4096)},${Math.round(p.y * 4096)}`;
  const ends = new Map<string, [Point2, Point2][]>();
  for (const s of segs) {
    for (const p of s) {
      const k = key(p);
      const list = ends.get(k);
      if (list) list.push(s);
      else ends.set(k, [s]);
    }
  }

  const used = new Set<[Point2, Point2]>();
  const lines: Point2[][] = [];
  const walk = (line: Point2[]) => {
    for (;;) {
      const tip = line[line.length - 1] as Point2;
      const next = (ends.get(key(tip)) ?? []).find((t) => !used.has(t));
      if (!next) return;
      used.add(next);
      line.push(key(next[0]) === key(tip) ? next[1] : next[0]);
    }
  };

  for (const s of segs) {
    if (used.has(s)) continue;
    used.add(s);
    const line = [s[0], s[1]];
    walk(line);
    line.reverse();
    walk(line);
    if (line.length > 3) lines.push(line);
  }

  return lines.map((line) =>
    line.map((p) => ({ x: originX + p.x * emPerCell, y: originY + p.y * emPerCell })),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/field.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/field.ts packages/core/test/render/tube/field.test.ts
git commit -m "add a signed distance field and marching-squares isocontours"
```

---

### Task 2: Resampling, smoothing and curvature

**Files:**
- Create: `packages/core/src/render/tube/resample.ts`
- Test: `packages/core/test/render/tube/resample.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { minCurvatureRadius, resample, smooth } from '../../../src/render/tube/resample.js';

/** A circle of radius r, sampled unevenly so resampling has something to correct. */
function circle(r: number, n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) ** 1.6 * Math.PI * 2;
    return { x: Math.cos(t) * r, y: Math.sin(t) * r };
  });
}

describe('resample', () => {
  it('spaces points by arc length, not by input point count', () => {
    const sparse = resample(circle(1, 12), 0.1);
    const dense = resample(circle(1, 400), 0.1);
    // Same curve, wildly different input resolution: output counts must agree.
    expect(Math.abs(sparse.length - dense.length)).toBeLessThanOrEqual(1);
  });

  it('scales point count with path length', () => {
    const small = resample(circle(1, 100), 0.1);
    const big = resample(circle(2, 100), 0.1);
    expect(big.length).toBeGreaterThan(small.length * 1.8);
  });
});

describe('minCurvatureRadius', () => {
  it('recovers the radius of a circle', () => {
    const r = minCurvatureRadius(resample(circle(0.5, 200), 0.01));
    expect(r).toBeGreaterThan(0.45);
    expect(r).toBeLessThan(0.55);
  });

  it('reports a larger radius after smoothing removes staircase noise', () => {
    const noisy = circle(1, 200).map((p, i) => ({
      x: p.x + (i % 2 ? 0.004 : -0.004),
      y: p.y + (i % 3 ? 0.004 : -0.004),
    }));
    const before = minCurvatureRadius(noisy);
    const after = minCurvatureRadius(smooth(noisy, 3));
    expect(after).toBeGreaterThan(before * 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/resample.test.ts`
Expected: FAIL — cannot resolve `tube/resample.js`

- [ ] **Step 3: Write the implementation**

```ts
import type { Point2 } from './field.js';

const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(line: Point2[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += dist(line[i - 1] as Point2, line[i] as Point2);
  return total;
}

/** Even arc-length spacing, so point count tracks length rather than how a curve was authored. */
export function resample(line: Point2[], spacing: number): Point2[] {
  if (line.length < 2) return line.slice();
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const d = dist(line[i - 1] as Point2, line[i] as Point2);
    seg.push(d);
    total += d;
  }
  const n = Math.max(8, Math.round(total / spacing));
  const step = total / n;
  const out: Point2[] = [];
  let idx = 0;
  let walked = 0;

  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (idx < seg.length - 1 && walked + (seg[idx] as number) < target) {
      walked += seg[idx] as number;
      idx++;
    }
    const len = seg[idx] as number;
    const t = len > 0 ? (target - walked) / len : 0;
    const a = line[idx] as Point2;
    const b = line[idx + 1] as Point2;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Closed three-tap smoothing. Marching squares emits staircase noise at grid scale. */
export function smooth(line: Point2[], passes: number): Point2[] {
  let cur = line;
  for (let p = 0; p < passes; p++) {
    cur = cur.map((_, i) => {
      const a = cur[(i - 1 + cur.length) % cur.length] as Point2;
      const b = cur[i] as Point2;
      const c = cur[(i + 1) % cur.length] as Point2;
      return { x: a.x * 0.25 + b.x * 0.5 + c.x * 0.25, y: a.y * 0.25 + b.y * 0.5 + c.y * 0.25 };
    });
  }
  return cur;
}

/** Radius of the circle through each consecutive triple; the sweep pinches past this. */
export function minCurvatureRadius(line: Point2[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i + 1 < line.length; i++) {
    const A = line[i - 1] as Point2;
    const B = line[i] as Point2;
    const C = line[i + 1] as Point2;
    const a = dist(B, C);
    const b = dist(A, C);
    const c = dist(A, B);
    const area = Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y)) / 2;
    if (area < 1e-12) continue;
    min = Math.min(min, (a * b * c) / (4 * area));
  }
  return min;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/resample.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/resample.ts packages/core/test/render/tube/resample.test.ts
git commit -m "resample tube paths by arc length and measure their curvature"
```

---

### Task 3: Surfaces

**Files:**
- Create: `packages/core/src/render/tube/surfaces.ts`
- Test: `packages/core/test/render/tube/surfaces.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { surfacesOf, wallPointAt } from '../../../src/render/tube/surfaces.js';

function square(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(-0.5, 0.5);
  s.closePath();
  return s;
}

function ring(): THREE.Shape {
  const outer = square();
  const hole = new THREE.Path();
  hole.moveTo(-0.2, -0.2);
  hole.lineTo(-0.2, 0.2);
  hole.lineTo(0.2, 0.2);
  hole.lineTo(0.2, -0.2);
  hole.closePath();
  outer.holes.push(hole);
  return outer;
}

describe('surfacesOf', () => {
  it('gives a front, a back and one wall per contour', () => {
    const one = surfacesOf([square()], 0.3);
    expect(one.filter((s) => s.kind === 'front')).toHaveLength(1);
    expect(one.filter((s) => s.kind === 'back')).toHaveLength(1);
    expect(one.filter((s) => s.kind === 'wall')).toHaveLength(1);

    const two = surfacesOf([ring()], 0.3);
    expect(two.filter((s) => s.kind === 'wall')).toHaveLength(2);
  });
});

describe('wallPointAt', () => {
  it('wraps arc length instead of clamping it', () => {
    const wall = surfacesOf([square()], 0.3).find((s) => s.kind === 'wall');
    if (!wall || wall.kind !== 'wall') throw new Error('no wall');

    // A step across the seam must be a small move in 3D, not a jump across the letter.
    const before = wallPointAt(wall, wall.perimeter - 0.01, 0.5);
    const after = wallPointAt(wall, 0.01, 0.5);
    expect(before.distanceTo(after)).toBeLessThan(0.1);
  });

  it('places depth between the back and front planes', () => {
    const wall = surfacesOf([square()], 0.3).find((s) => s.kind === 'wall');
    if (!wall || wall.kind !== 'wall') throw new Error('no wall');
    expect(wallPointAt(wall, 0, 0).z).toBeCloseTo(0, 5);
    expect(wallPointAt(wall, 0, 1).z).toBeCloseTo(0.3, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/surfaces.test.ts`
Expected: FAIL — cannot resolve `tube/surfaces.js`

- [ ] **Step 3: Write the implementation**

```ts
import * as THREE from 'three';
import type { Point2 } from './field.js';
import { pathLength, resample } from './resample.js';

export type SurfaceKind = 'front' | 'back' | 'wall';

export interface FaceSurface {
  kind: 'front' | 'back';
  z: number;
  /** Outer contour first, then holes — the polygons the field rasterises. */
  polygons: Point2[][];
}

export interface WallSurface {
  kind: 'wall';
  /** One contour's points, evenly spaced, not repeating the first point. */
  ring: Point2[];
  perimeter: number;
  depth: number;
}

export type Surface = FaceSurface | WallSurface;

/** Spacing used to walk a contour into the ring; fine enough that a wall reads as smooth. */
const RING_SPACING = 0.01;

function contourPoints(contour: THREE.Shape | THREE.Path): Point2[] {
  // getPoints subdivides per curve, so it is only used here to get *a* polygon; resample then
  // makes the spacing uniform and independent of how the font authored the glyph.
  const raw = contour.getPoints(24).map((p) => ({ x: p.x, y: p.y }));
  const first = raw[0];
  const last = raw[raw.length - 1];
  if (raw.length > 1 && first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) {
    raw.pop();
  }
  return resample([...raw, raw[0] as Point2], RING_SPACING);
}

export function surfacesOf(shapes: THREE.Shape[], depth: number): Surface[] {
  const polygons: Point2[][] = [];
  const walls: WallSurface[] = [];

  for (const shape of shapes) {
    for (const contour of [shape, ...shape.holes]) {
      const ring = contourPoints(contour);
      if (ring.length < 3) continue;
      polygons.push(ring);
      walls.push({
        kind: 'wall',
        ring,
        perimeter: pathLength([...ring, ring[0] as Point2]),
        depth,
      });
    }
  }

  if (polygons.length === 0) return [];
  return [
    { kind: 'front', z: depth, polygons },
    { kind: 'back', z: 0, polygons },
    ...walls,
  ];
}

/**
 * A point on the wall from arc length and a 0..1 depth fraction. Arc length wraps: a generator
 * that let it clamp would produce a run jumping the width of the letter at the seam.
 */
export function wallPointAt(wall: WallSurface, along: number, depthFraction: number): THREE.Vector3 {
  const n = wall.ring.length;
  const wrapped = ((along % wall.perimeter) + wall.perimeter) % wall.perimeter;
  const t = (wrapped / wall.perimeter) * n;
  const i = Math.floor(t) % n;
  const frac = t - Math.floor(t);
  const a = wall.ring[i] as Point2;
  const b = wall.ring[(i + 1) % n] as Point2;
  return new THREE.Vector3(
    a.x + (b.x - a.x) * frac,
    a.y + (b.y - a.y) * frac,
    depthFraction * wall.depth,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/surfaces.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/surfaces.ts packages/core/test/render/tube/surfaces.test.ts
git commit -m "map a glyph prism's front, back and wall surfaces to 2D coordinates"
```

---

### Task 4: Generators

**Files:**
- Create: `packages/core/src/render/tube/generators.ts`
- Test: `packages/core/test/render/tube/generators.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generatePaths } from '../../../src/render/tube/generators.js';
import { surfacesOf } from '../../../src/render/tube/surfaces.js';

function square(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(-0.5, 0.5);
  s.closePath();
  return s;
}

const OPTS = { level: 0, spacing: 0.02, wallDepth: 0.5, resolution: 192, pad: 0.4 };

describe('generatePaths', () => {
  it('emits nothing for surfaces that were not requested', () => {
    const surfaces = surfacesOf([square()], 0.3);
    expect(generatePaths(surfaces, [], OPTS)).toHaveLength(0);
  });

  it('puts front-face paths at the front plane', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front'], OPTS);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      for (const p of path.points) expect(p.z).toBeCloseTo(0.3, 5);
    }
  });

  it('emits 3D polylines on the wall that vary in z when asked to', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['wall'], { ...OPTS, wallRise: 0.4 });
    expect(paths.length).toBeGreaterThan(0);
    const zs = (paths[0]?.points ?? []).map((p) => p.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.01);
  });

  it('records which surface each path came from', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front', 'back'], OPTS);
    expect(new Set(paths.map((p) => p.surface))).toEqual(new Set(['front', 'back']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/generators.test.ts`
Expected: FAIL — cannot resolve `tube/generators.js`

- [ ] **Step 3: Write the implementation**

```ts
import * as THREE from 'three';
import { isoContours, signedDistanceField } from './field.js';
import { resample, smooth } from './resample.js';
import { type Surface, type SurfaceKind, wallPointAt } from './surfaces.js';

export interface GeneratedPath {
  points: THREE.Vector3[];
  surface: SurfaceKind;
  /** True when the path closes on itself, which decides whether cutting must wrap. */
  closed: boolean;
}

export interface GenerateOptions {
  /** Isocontour level in em: negative insets, zero rides the outline, positive stands off. */
  level: number;
  spacing: number;
  /** Depth fraction the wall generator runs at, 0 back to 1 front. */
  wallDepth: number;
  /** Peak-to-peak depth swing along a wall path, as a fraction of depth. 0 is a flat band. */
  wallRise?: number;
  resolution: number;
  pad: number;
}

/** Passes of three-tap smoothing applied to raw isocontours before they are used. */
const SMOOTH_PASSES = 3;

export function generatePaths(
  surfaces: Surface[],
  enabled: SurfaceKind[],
  opts: GenerateOptions,
): GeneratedPath[] {
  const want = new Set(enabled);
  const out: GeneratedPath[] = [];

  for (const surface of surfaces) {
    if (!want.has(surface.kind)) continue;

    if (surface.kind === 'front' || surface.kind === 'back') {
      const field = signedDistanceField(surface.polygons, {
        resolution: opts.resolution,
        pad: opts.pad,
      });
      for (const line of isoContours(field, opts.level)) {
        const cooked = smooth(resample(line, opts.spacing), SMOOTH_PASSES);
        if (cooked.length < 4) continue;
        out.push({
          points: cooked.map((p) => new THREE.Vector3(p.x, p.y, surface.z)),
          surface: surface.kind,
          closed: true,
        });
      }
      continue;
    }

    const steps = Math.max(8, Math.round(surface.perimeter / opts.spacing));
    const rise = opts.wallRise ?? 0;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < steps; i++) {
      const along = (i / steps) * surface.perimeter;
      const wave = rise === 0 ? 0 : (rise / 2) * Math.sin((i / steps) * Math.PI * 2);
      const depth = Math.min(1, Math.max(0, opts.wallDepth + wave));
      points.push(wallPointAt(surface, along, depth));
    }
    out.push({ points, surface: 'wall', closed: true });
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/generators.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/generators.ts packages/core/test/render/tube/generators.test.ts
git commit -m "generate tube paths on each glyph surface as 3D polylines"
```

---

### Task 4b: Connectors between surfaces

**Files:**
- Modify: `packages/core/src/render/tube/generators.ts`
- Test: `packages/core/test/render/tube/generators.test.ts`

Connectors are the runs whose direction is mostly z — the returns that dive back through the
backing. They are the reason runs are 3D polylines rather than planar paths carrying a depth
profile, so without them the `front + back` mode shows two disconnected sheets of tube.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/tube/generators.test.ts`:

```ts
import { generateConnectors } from '../../../src/render/tube/generators.js';

describe('generateConnectors', () => {
  it('emits nothing unless two surfaces are present', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const frontOnly = generatePaths(surfaces, ['front'], OPTS);
    expect(generateConnectors(frontOnly, { count: 3, overshoot: 0.05 })).toHaveLength(0);
  });

  it('joins front paths to back paths', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front', 'back'], OPTS);
    const links = generateConnectors(paths, { count: 3, overshoot: 0.05 });
    expect(links).toHaveLength(3);
    for (const link of links) expect(link.surface).toBe('connector');
  });

  it('runs mostly along z', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front', 'back'], OPTS);
    const link = generateConnectors(paths, { count: 1, overshoot: 0.05 })[0];
    if (!link) throw new Error('no connector');
    const a = link.points[0];
    const b = link.points[link.points.length - 1];
    if (!a || !b) throw new Error('empty connector');
    expect(Math.abs(b.z - a.z)).toBeGreaterThan(Math.hypot(b.x - a.x, b.y - a.y));
  });

  it('overshoots past the back plane so the tube disappears into the backing', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front', 'back'], OPTS);
    const link = generateConnectors(paths, { count: 1, overshoot: 0.05 })[0];
    if (!link) throw new Error('no connector');
    const zs = link.points.map((p) => p.z);
    expect(Math.min(...zs)).toBeLessThan(0);
  });

  it('is open, not closed', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front', 'back'], OPTS);
    for (const link of generateConnectors(paths, { count: 2, overshoot: 0.05 })) {
      expect(link.closed).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/generators.test.ts`
Expected: FAIL — `generateConnectors` is not exported

- [ ] **Step 3: Extend `SurfaceKind` and add the generator**

In `surfaces.ts`, widen the kind so a connector can be labelled without pretending it lives on a
surface:

```ts
export type SurfaceKind = 'front' | 'back' | 'wall' | 'connector';
```

`surfacesOf` never emits a `connector` surface — the name only ever appears on a path and its
runs, which is what lets selection and color treat connectors differently later.

In `generators.ts`:

```ts
export interface ConnectorOptions {
  /** How many connectors to emit per front path. */
  count: number;
  /** How far past the back plane the tube continues, in em. */
  overshoot: number;
}

/**
 * Short runs joining a front path to the back path beneath it, travelling along z. Anchors are
 * spaced evenly along the front path rather than placed at its ends, because the ends move
 * whenever the run count changes and a connector that follows them would jump.
 */
export function generateConnectors(
  paths: GeneratedPath[],
  opts: ConnectorOptions,
): GeneratedPath[] {
  const front = paths.filter((p) => p.surface === 'front');
  const back = paths.filter((p) => p.surface === 'back');
  if (front.length === 0 || back.length === 0) return [];

  const backZ = (back[0]?.points[0] as THREE.Vector3 | undefined)?.z ?? 0;
  const out: GeneratedPath[] = [];

  for (const path of front) {
    if (path.points.length === 0) continue;
    for (let k = 0; k < opts.count; k++) {
      const anchor = path.points[
        Math.floor((k / opts.count) * path.points.length)
      ] as THREE.Vector3;
      const frontZ = anchor.z;
      out.push({
        points: [
          new THREE.Vector3(anchor.x, anchor.y, frontZ),
          new THREE.Vector3(anchor.x, anchor.y, (frontZ + backZ) / 2),
          new THREE.Vector3(anchor.x, anchor.y, backZ - opts.overshoot),
        ],
        surface: 'connector',
        closed: false,
      });
      if (out.length >= opts.count * front.length) break;
    }
  }
  return out.slice(0, opts.count * Math.max(1, front.length));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/generators.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Wire connectors into the blueprint**

This lands in Task 8's `tube/index.ts`. Add to `TubeSpec`:

```ts
  /** Connectors emitted per front path when both faces are enabled. 0 disables them. */
  connectors?: number;
  /** How far a connector continues past the back plane, in em. */
  connectorOvershoot?: number;
```

And in `buildTubeBlueprint`, after `generatePaths`:

```ts
  const links =
    spec.connectors && spec.connectors > 0
      ? generateConnectors(paths, {
          count: spec.connectors,
          overshoot: spec.connectorOvershoot ?? 0.05,
        })
      : [];
  const runs = assign(
    cutIntoRuns([...paths, ...links], { runs: spec.runs, minRun: spec.minRun }),
    spec.select,
    spec.colors,
    seed,
  );
```

A connector is three points and shorter than most runs, so `minRun` will drop it unless the floor
is below the glyph depth. That is the correct interaction — a connector shorter than the tube is
wide is a bead like any other — but it means a mode enabling connectors wants a floor under the
extrude depth, which is 0.28 em by default.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/generators.ts packages/core/src/render/tube/surfaces.ts \
  packages/core/test/render/tube/generators.test.ts
git commit -m "add connector runs joining the front and back faces"
```

---

### Task 5: Cutting into runs

**Files:**
- Create: `packages/core/src/render/tube/runs.ts`
- Test: `packages/core/test/render/tube/runs.test.ts`

The spec calls for filtering `glyphToShapes`'s zero-length `LineCurve`s before any tangent test.
This pipeline resamples contours into polylines first, so a zero-length curve contributes no
points and never reaches a tangent test — the guard lives in the corner detector instead, which
skips zero-length steps. Nothing separate to filter.

- [ ] **Step 1: Write the failing test**

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cutIntoRuns } from '../../../src/render/tube/runs.js';

/** A closed square path in 3D, four corners, evenly sampled along each side. */
function squarePath(): THREE.Vector3[] {
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const pts: THREE.Vector3[] = [];
  for (let c = 0; c < 4; c++) {
    const [ax, ay] = corners[c] as number[];
    const [bx, by] = corners[(c + 1) % 4] as number[];
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector3(
        (ax as number) + ((bx as number) - (ax as number)) * t,
        (ay as number) + ((by as number) - (ay as number)) * t,
        0,
      ));
    }
  }
  return pts;
}

/** A closed circle — no corners anywhere. */
function circlePath(): THREE.Vector3[] {
  return Array.from({ length: 120 }, (_, i) => {
    const t = (i / 120) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(t) * 0.5, Math.sin(t) * 0.5, 0);
  });
}

const PATH = (points: THREE.Vector3[]) => ({ points, surface: 'front' as const, closed: true });

describe('corner detection', () => {
  it('ignores repeated points instead of reading them as corners', () => {
    // glyphToShapes emits zero-length LineCurves between curve pairs, which survive into the
    // polyline as duplicate points. A tangent test that does not guard against them sees a
    // corner at every one and cuts the path to shreds.
    const doubled: THREE.Vector3[] = [];
    for (const p of circlePath()) {
      doubled.push(p, p.clone());
    }
    const runs = cutIntoRuns([PATH(doubled)], { runs: 3, minRun: 0 });
    expect(runs).toHaveLength(3);
  });
});

describe('cutIntoRuns', () => {
  it('cuts a square at its four corners', () => {
    const runs = cutIntoRuns([PATH(squarePath())], { runs: 1, minRun: 0 });
    expect(runs).toHaveLength(4);
  });

  it('cuts a cornerless loop by count alone', () => {
    const runs = cutIntoRuns([PATH(circlePath())], { runs: 5, minRun: 0 });
    expect(runs).toHaveLength(5);
  });

  it('never returns fewer runs than there are corners', () => {
    const runs = cutIntoRuns([PATH(squarePath())], { runs: 2, minRun: 0 });
    expect(runs).toHaveLength(4);
  });

  it('reaches the requested count when it exceeds the corner count', () => {
    const runs = cutIntoRuns([PATH(squarePath())], { runs: 8, minRun: 0 });
    expect(runs).toHaveLength(8);
  });

  it('drops runs under the floor', () => {
    const loose = cutIntoRuns([PATH(squarePath())], { runs: 20, minRun: 0 });
    const floored = cutIntoRuns([PATH(squarePath())], { runs: 20, minRun: 0.3 });
    expect(floored.length).toBeLessThan(loose.length);
    for (const run of floored) expect(run.length).toBeGreaterThanOrEqual(0.3);
  });

  it('carries surface, length and index on every run', () => {
    const runs = cutIntoRuns([PATH(squarePath())], { runs: 4, minRun: 0 });
    runs.forEach((run, i) => {
      expect(run.surface).toBe('front');
      expect(run.index).toBe(i);
      expect(run.length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/runs.test.ts`
Expected: FAIL — cannot resolve `tube/runs.js`

- [ ] **Step 3: Write the implementation**

```ts
import type * as THREE from 'three';
import type { GeneratedPath } from './generators.js';
import type { SurfaceKind } from './surfaces.js';

export interface Run {
  points: THREE.Vector3[];
  surface: SurfaceKind;
  length: number;
  /** Position in the run list. Stable across builds, so a post-effect can address a run by it. */
  index: number;
  lit: boolean;
  color: number;
}

export interface CutOptions {
  /** Requested run count per glyph. Cannot go below the corner count. */
  runs: number;
  /** Runs shorter than this are dropped and left dark, in em. */
  minRun: number;
  /** Tangent break counted as a corner, in radians. */
  cornerAngle?: number;
}

const DEFAULT_CORNER = Math.PI / 6;

function polyLength(points: THREE.Vector3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += (points[i] as THREE.Vector3).distanceTo(points[i - 1] as THREE.Vector3);
  }
  return total;
}

/** Indices where the direction breaks by more than `angle`. */
function cornersOf(points: THREE.Vector3[], closed: boolean, angle: number): number[] {
  const out: number[] = [];
  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 1; i < last; i++) {
    const prev = points[i - 1] as THREE.Vector3;
    const cur = points[i % n] as THREE.Vector3;
    const next = points[(i + 1) % n] as THREE.Vector3;
    const a = cur.clone().sub(prev);
    const b = next.clone().sub(cur);
    if (a.lengthSq() < 1e-18 || b.lengthSq() < 1e-18) continue;
    if (a.normalize().angleTo(b.normalize()) > angle) out.push(i);
  }
  return out;
}

function spansOf(path: GeneratedPath, angle: number): THREE.Vector3[][] {
  const { points, closed } = path;
  const corners = cornersOf(points, closed, angle);
  if (corners.length === 0) {
    return [closed ? [...points, points[0] as THREE.Vector3] : points.slice()];
  }
  const spans: THREE.Vector3[][] = [];
  for (let k = 0; k < corners.length; k++) {
    const start = corners[k] as number;
    const end = corners[(k + 1) % corners.length] as number;
    const span: THREE.Vector3[] = [];
    let i = start;
    do {
      span.push(points[i % points.length] as THREE.Vector3);
      i++;
    } while (i % points.length !== end && span.length <= points.length);
    span.push(points[end % points.length] as THREE.Vector3);
    if (span.length > 1) spans.push(span);
  }
  return spans;
}

function slice(span: THREE.Vector3[], pieces: number): THREE.Vector3[][] {
  if (pieces <= 1) return [span];
  const per = polyLength(span) / pieces;
  const out: THREE.Vector3[][] = [];
  let acc = 0;
  let cur: THREE.Vector3[] = [span[0] as THREE.Vector3];
  for (let i = 1; i < span.length; i++) {
    acc += (span[i] as THREE.Vector3).distanceTo(span[i - 1] as THREE.Vector3);
    cur.push(span[i] as THREE.Vector3);
    if (acc >= per && out.length < pieces - 1 && i < span.length - 1) {
      out.push(cur);
      cur = [span[i] as THREE.Vector3];
      acc = 0;
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/**
 * Corners are mandatory cuts; `runs` inserts the rest, distributed across spans by length with
 * largest remainder. The count is a request, not a guarantee — it cannot go below the corner
 * count, and the floor can take the result lower still.
 */
export function cutIntoRuns(paths: GeneratedPath[], opts: CutOptions): Run[] {
  const angle = opts.cornerAngle ?? DEFAULT_CORNER;
  const spans: { points: THREE.Vector3[]; surface: SurfaceKind }[] = [];
  for (const path of paths) {
    for (const span of spansOf(path, angle)) spans.push({ points: span, surface: path.surface });
  }
  if (spans.length === 0) return [];

  const lengths = spans.map((s) => polyLength(s.points));
  const total = lengths.reduce((a, b) => a + b, 0);
  const extra = Math.max(0, opts.runs - spans.length);
  const want = lengths.map((l) => (total > 0 ? (extra * l) / total : 0));
  const base = want.map(Math.floor);
  let left = extra - base.reduce((a, b) => a + b, 0);
  for (const [, i] of want
    .map((w, i) => [w - (base[i] as number), i] as const)
    .sort((a, b) => b[0] - a[0])) {
    if (left <= 0) break;
    base[i] = (base[i] as number) + 1;
    left--;
  }

  const out: Run[] = [];
  spans.forEach((span, i) => {
    for (const piece of slice(span.points, 1 + (base[i] as number))) {
      const length = polyLength(piece);
      if (length < opts.minRun) continue;
      out.push({
        points: piece,
        surface: span.surface,
        length,
        index: out.length,
        lit: true,
        color: 0,
      });
    }
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/runs.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/runs.test.ts
git commit -m "cut generated paths into an addressable run list"
```

---

### Task 6: Selection and color

**Files:**
- Create: `packages/core/src/render/tube/assign.ts`
- Test: `packages/core/test/render/tube/assign.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { assign } from '../../../src/render/tube/assign.js';
import type { Run } from '../../../src/render/tube/runs.js';

function runs(n: number): Run[] {
  return Array.from({ length: n }, (_, i) => ({
    points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(i + 1, 0, 0)],
    surface: 'front' as const,
    length: i + 1,
    index: i,
    lit: true,
    color: 0,
  }));
}

const COLORS = [0xff0000, 0x00ff00, 0x0000ff];

describe('assign', () => {
  it('lights everything at amount 1', () => {
    const out = assign(runs(6), { by: 'seed', amount: 1 }, COLORS, 3);
    expect(out.every((r) => r.lit)).toBe(true);
  });

  it('lights nothing at amount 0', () => {
    const out = assign(runs(6), { by: 'seed', amount: 0 }, COLORS, 3);
    expect(out.some((r) => r.lit)).toBe(false);
  });

  it('reads an amount above 1 as a count', () => {
    const out = assign(runs(10), { by: 'length', amount: 4 }, COLORS, 3);
    expect(out.filter((r) => r.lit)).toHaveLength(4);
  });

  it('lights the longest runs when ordering by length', () => {
    const out = assign(runs(10), { by: 'length', amount: 3 }, COLORS, 3);
    expect(out.filter((r) => r.lit).map((r) => r.index).sort((a, b) => a - b)).toEqual([7, 8, 9]);
  });

  it('alternates when ordering by index with a stride', () => {
    const out = assign(runs(6), { by: 'index', amount: 1, stride: 2 }, COLORS, 3);
    expect(out.filter((r) => r.lit).map((r) => r.index)).toEqual([0, 2, 4]);
  });

  it('is deterministic for the same seed and unequal for different ones', () => {
    const a = assign(runs(12), { by: 'seed', amount: 0.5 }, COLORS, 3).map((r) => r.lit);
    const b = assign(runs(12), { by: 'seed', amount: 0.5 }, COLORS, 3).map((r) => r.lit);
    const c = assign(runs(12), { by: 'seed', amount: 0.5 }, COLORS, 9).map((r) => r.lit);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('cycles the palette across runs and tolerates a single color', () => {
    const many = assign(runs(5), { by: 'seed', amount: 1 }, COLORS, 3);
    expect(many.map((r) => r.color)).toEqual([0xff0000, 0x00ff00, 0x0000ff, 0xff0000, 0x00ff00]);
    const one = assign(runs(3), { by: 'seed', amount: 1 }, [0xabcdef], 3);
    expect(one.every((r) => r.color === 0xabcdef)).toBe(true);
  });

  it('leaves the run order untouched', () => {
    const out = assign(runs(6), { by: 'length', amount: 2 }, COLORS, 3);
    expect(out.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/assign.test.ts`
Expected: FAIL — cannot resolve `tube/assign.js`

- [ ] **Step 3: Write the implementation**

```ts
import type { Run } from './runs.js';

export interface SelectSpec {
  /** How runs are ordered before the amount is taken off the front. */
  by: 'seed' | 'length' | 'index';
  /** 0..1 is a fraction of the run count; above 1 is a literal count. */
  amount: number;
  /** Only read when `by` is 'index': light every nth run. */
  stride?: number;
}

/** Same generator the chunk scatter uses, so seeding behaves consistently across decorations. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sets `lit` and `color` in place of the incoming order. The run list order never changes —
 * a post-effects layer addresses runs by index, so reordering here would silently retarget it.
 */
export function assign(
  runs: Run[],
  select: SelectSpec,
  colors: number[],
  seed: number,
): Run[] {
  if (runs.length === 0) return runs;

  if (select.by === 'index' && select.stride && select.stride > 1) {
    const stride = Math.round(select.stride);
    for (const run of runs) run.lit = run.index % stride === 0;
  } else {
    const count =
      select.amount > 1
        ? Math.min(runs.length, Math.round(select.amount))
        : Math.round(Math.min(1, Math.max(0, select.amount)) * runs.length);

    let order: number[];
    if (select.by === 'length') {
      order = runs
        .map((r, i) => [r.length, i] as const)
        .sort((a, b) => b[0] - a[0])
        .map(([, i]) => i);
    } else if (select.by === 'index') {
      order = runs.map((_, i) => i);
    } else {
      const random = rng(Math.round(seed * 2654435761) ^ 0x5eed);
      order = runs
        .map((_, i) => [random(), i] as const)
        .sort((a, b) => a[0] - b[0])
        .map(([, i]) => i);
    }

    const chosen = new Set(order.slice(0, count));
    for (const run of runs) run.lit = chosen.has(run.index);
  }

  const palette = colors.length > 0 ? colors : [0xffffff];
  let n = 0;
  for (const run of runs) {
    if (!run.lit) continue;
    run.color = palette[n % palette.length] as number;
    n++;
  }
  return runs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/assign.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/assign.ts packages/core/test/render/tube/assign.test.ts
git commit -m "select which tube runs light and cycle colors across them"
```

---

### Task 7: Sweeping with a tapered radius

**Files:**
- Create: `packages/core/src/render/tube/sweep.ts`
- Test: `packages/core/test/render/tube/sweep.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sweepRadius, sweepRun } from '../../../src/render/tube/sweep.js';
import type { Run } from '../../../src/render/tube/runs.js';

function arcRun(radius: number, sweep: number): Run {
  const points = Array.from({ length: 40 }, (_, i) => {
    const t = (i / 39) * sweep;
    return new THREE.Vector3(Math.cos(t) * radius, Math.sin(t) * radius, 0);
  });
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += (points[i] as THREE.Vector3).distanceTo(points[i - 1] as THREE.Vector3);
  }
  return { points, surface: 'front', length, index: 0, lit: true, color: 0xffffff };
}

describe('sweepRadius', () => {
  it('keeps the requested radius on a gentle path', () => {
    expect(sweepRadius(arcRun(1, Math.PI / 2), 0.05)).toBeCloseTo(0.05, 3);
  });

  it('tapers below the local curvature radius on a tight path', () => {
    // A 0.02 radius arc cannot carry a 0.05 tube; the sweep would turn inside out.
    const r = sweepRadius(arcRun(0.02, Math.PI / 2), 0.05);
    expect(r).toBeLessThan(0.02);
    expect(r).toBeGreaterThan(0);
  });
});

describe('sweepRun', () => {
  it('builds geometry with position and normal attributes', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.05, 8);
    expect(geo.getAttribute('position').count).toBeGreaterThan(0);
    expect(geo.getAttribute('normal').count).toBeGreaterThan(0);
    geo.dispose();
  });

  it('returns null for a run too short to sweep', () => {
    const run = arcRun(1, Math.PI / 2);
    run.points = run.points.slice(0, 1);
    expect(sweepRun(run, 0.05, 8)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/sweep.test.ts`
Expected: FAIL — cannot resolve `tube/sweep.js`

- [ ] **Step 3: Write the implementation**

```ts
import * as THREE from 'three';
import { minCurvatureRadius } from './resample.js';
import type { Run } from './runs.js';

/** How much of the local curvature radius a tube may occupy before it self-intersects. */
const CLEARANCE = 0.8;

/**
 * A sweep whose radius exceeds the path's local radius of curvature turns inside out. Measured
 * on the lab font this is common rather than exotic, and the run floor does not catch it — a run
 * can be long and still contain one tight corner.
 */
export function sweepRadius(run: Run, requested: number): number {
  const flat = run.points.map((p) => ({ x: p.x, y: p.y }));
  const tightest = minCurvatureRadius(flat);
  if (!Number.isFinite(tightest)) return requested;
  return Math.min(requested, tightest * CLEARANCE);
}

export function sweepRun(run: Run, requested: number, segments: number): THREE.BufferGeometry | null {
  if (run.points.length < 2) return null;
  const radius = sweepRadius(run, requested);
  if (radius <= 0) return null;
  // Catmull-Rom rather than a polyline: neon tube cannot bend square, and the run's own points
  // are already arc-length spaced, so centripetal parameterisation will not overshoot.
  const curve = new THREE.CatmullRomCurve3(run.points, false, 'centripetal');
  return new THREE.TubeGeometry(curve, run.points.length, radius, segments, false);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/sweep.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/sweep.ts packages/core/test/render/tube/sweep.test.ts
git commit -m "sweep runs into tube geometry with radius tapered against curvature"
```

---

### Task 8: Assemble the blueprint and replace TubeSpec

**Files:**
- Create: `packages/core/src/render/tube/index.ts`
- Modify: `packages/core/src/render/decoration.ts` (remove `TubeSpec`, `TubeBlueprint`, `buildTubeBlueprint`, `contourPoints`, `signedArea`, `insetContour`, `CONTOUR_SEGMENTS`, `MITER_LIMIT`; re-export from `tube/`)
- Modify: `packages/core/test/render/decoration.test.ts` (drop the tube cases — they test deleted code)
- Test: `packages/core/test/render/tube/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTubeBlueprint, type TubeSpec } from '../../../src/render/tube/index.js';

const SPEC: TubeSpec = {
  kind: 'tube',
  radius: 0.03,
  segments: 6,
  spacing: 0.02,
  surfaces: ['front'],
  level: 0,
  runs: 6,
  minRun: 0.05,
  select: { by: 'seed', amount: 1 },
  colors: [0xff2d95],
  look: {},
  dark: {},
};

function square(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(-0.5, 0.5);
  s.closePath();
  return s;
}

describe('buildTubeBlueprint', () => {
  it('produces lit geometry and a run list', () => {
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0);
    expect(bp.kind).toBe('tube');
    expect(bp.runs.length).toBeGreaterThan(0);
    expect(bp.lit.length).toBeGreaterThan(0);
    bp.dispose();
  });

  it('gives unlit runs their own geometry rather than skipping them', () => {
    const bp = buildTubeBlueprint([square()], { ...SPEC, select: { by: 'seed', amount: 0.5 } }, 0.3, 0);
    expect(bp.dark.length).toBeGreaterThan(0);
    expect(bp.lit.length + bp.dark.length).toBe(bp.runs.length);
    bp.dispose();
  });

  it('is stable across two builds with the same seed', () => {
    const a = buildTubeBlueprint([square()], SPEC, 0.3, 3);
    const b = buildTubeBlueprint([square()], SPEC, 0.3, 3);
    expect(a.runs.map((r) => [r.index, r.lit, r.color])).toEqual(
      b.runs.map((r) => [r.index, r.lit, r.color]),
    );
    a.dispose();
    b.dispose();
  });

  it('empties out rather than throwing when the level exceeds the glyph', () => {
    const bp = buildTubeBlueprint([square()], { ...SPEC, level: -2 }, 0.3, 0);
    expect(bp.runs).toHaveLength(0);
    expect(bp.lit).toHaveLength(0);
    bp.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/index.test.ts`
Expected: FAIL — cannot resolve `tube/index.js`

- [ ] **Step 3: Write the implementation**

```ts
import type * as THREE from 'three';
import type { MaterialSpec } from '../decoration.js';
import { assign, type SelectSpec } from './assign.js';
import { generatePaths } from './generators.js';
import { cutIntoRuns, type Run } from './runs.js';
import type { SurfaceKind } from './surfaces.js';
import { surfacesOf } from './surfaces.js';
import { sweepRun } from './sweep.js';

export type { SelectSpec } from './assign.js';
export type { Run } from './runs.js';
export type { SurfaceKind } from './surfaces.js';

export interface TubeSpec {
  kind: 'tube';
  /** Tube radius in em, tapered down where the path's curvature cannot carry it. */
  radius: number;
  /** Ring segments around the tube. */
  segments: number;
  /** Arc length in em between resampled path points. */
  spacing: number;
  surfaces: SurfaceKind[];
  /** Isocontour level in em: negative insets, zero rides the outline, positive stands off. */
  level: number;
  /** Requested runs per glyph. Bounded below by the corner count, above by `minRun`. */
  runs: number;
  minRun: number;
  /** Depth fraction the wall generator runs at, 0 back to 1 front. */
  wallDepth?: number;
  /** Peak-to-peak depth swing along a wall path, as a fraction of depth. */
  wallRise?: number;
  select: SelectSpec;
  colors: number[];
  look: MaterialSpec;
  /** Unlit glass. Present so a dark run is visibly there rather than missing. */
  dark: MaterialSpec;
}

export interface TubeBlueprint {
  kind: 'tube';
  runs: Run[];
  lit: THREE.BufferGeometry[];
  dark: THREE.BufferGeometry[];
  dispose(): void;
}

/** Grid cells per side for the face field, and the margin exterior levels need. */
const RESOLUTION = 256;
const PAD = 0.35;

export function buildTubeBlueprint(
  shapes: THREE.Shape[],
  spec: TubeSpec,
  depth: number,
  seed: number,
): TubeBlueprint {
  const surfaces = surfacesOf(shapes, depth);
  const paths = generatePaths(surfaces, spec.surfaces, {
    level: spec.level,
    spacing: spec.spacing,
    wallDepth: spec.wallDepth ?? 0.5,
    wallRise: spec.wallRise,
    resolution: RESOLUTION,
    pad: PAD,
  });
  const runs = assign(
    cutIntoRuns(paths, { runs: spec.runs, minRun: spec.minRun }),
    spec.select,
    spec.colors,
    seed,
  );

  const lit: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  for (const run of runs) {
    const geo = sweepRun(run, spec.radius, spec.segments);
    if (!geo) continue;
    (run.lit ? lit : dark).push(geo);
  }

  return {
    kind: 'tube',
    runs,
    lit,
    dark,
    dispose() {
      for (const g of lit) g.dispose();
      for (const g of dark) g.dispose();
      lit.length = 0;
      dark.length = 0;
      runs.length = 0;
    },
  };
}
```

Then in `packages/core/src/render/decoration.ts`, delete `CONTOUR_SEGMENTS`, `contourPoints`, `signedArea`, `MITER_LIMIT`, `insetContour`, `buildTubeBlueprint`, `TubeSpec` and `TubeBlueprint`, and re-export the replacements so `DecorationSpec` still resolves:

```ts
import type { TubeBlueprint, TubeSpec } from './tube/index.js';

export type { TubeBlueprint, TubeSpec } from './tube/index.js';
export { buildTubeBlueprint } from './tube/index.js';
```

`MaterialSpec`, `ChunkSpec`, `ChunkBlueprint`, `DecorationSpec` and `Blueprint` stay where they are.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/`
Expected: PASS across all seven tube test files

- [ ] **Step 5: Remove the dead tube tests from decoration.test.ts**

Delete the `SPEC` constant and every `describe('buildTubeBlueprint', ...)` case in `packages/core/test/render/decoration.test.ts` — they exercise `at`, `inset` and `loops`, none of which exist now. Keep `ring()` and `slab()` only if the chunk tests use them; otherwise delete those too.

Run: `npx vitest run packages/core/test/render/decoration.test.ts`
Expected: PASS, chunk cases only

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/index.ts packages/core/src/render/decoration.ts \
  packages/core/test/render/tube/index.test.ts packages/core/test/render/decoration.test.ts
git commit -m "replace the tube blueprint with the run pipeline"
```

---

### Task 9: Wire the look and the word

**Files:**
- Modify: `packages/core/src/render/looks.ts:161-183` (the `tubing` entry)
- Modify: `packages/core/src/render/word.ts:64-72` (decor cache) and `:132-135` (mesh attach)
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/test/render/looks.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/render/looks.test.ts`:

```ts
import { specOf } from '../../src/render/looks.js';

describe('tubing', () => {
  it('declares a tube decoration with a run pipeline', () => {
    const spec = specOf('tubing');
    const decoration = spec.decoration;
    expect(decoration?.kind).toBe('tube');
    if (decoration?.kind !== 'tube') throw new Error('not a tube');
    expect(decoration.surfaces.length).toBeGreaterThan(0);
    expect(decoration.runs).toBeGreaterThan(0);
    expect(decoration.minRun).toBeGreaterThan(0);
    expect(decoration.colors.length).toBeGreaterThan(0);
    expect(decoration.dark).toBeDefined();
  });

  it('still routes tint to the decoration and asks for bloom', () => {
    const spec = specOf('tubing');
    expect(spec.tintTo).toBe('decoration');
    expect(spec.bloom).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/looks.test.ts`
Expected: FAIL — `decoration.surfaces` is undefined

- [ ] **Step 3: Replace the `tubing` entry in `looks.ts`**

```ts
  tubing: {
    // A backing, not a body: what reads as the sign is the tube in front of it.
    color: 0x0a0010,
    metalness: 0,
    roughness: 0.5,
    clearcoat: 0,
    opacity: 0.08,
    bloom: true,
    tintTo: 'decoration',
    decoration: {
      kind: 'tube',
      radius: 0.045,
      segments: 10,
      spacing: 0.02,
      surfaces: ['front'],
      level: 0,
      runs: 7,
      minRun: 0.15,
      select: { by: 'seed', amount: 0.85 },
      colors: [0xff2d95],
      look: {
        color: 0x1a0010,
        emissive: 0xff2d95,
        emissiveIntensity: 3.4,
        clearcoat: 0,
        roughness: 0.35,
      },
      dark: {
        color: 0x2a1520,
        emissive: 0x000000,
        roughness: 0.25,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
      },
    },
  },
```

- [ ] **Step 4: Give `Word` a third material and attach both geometry sets**

In `word.ts`, add alongside `decorMaterials`:

```ts
  private readonly darkMaterials: (THREE.MeshPhysicalMaterial | null)[] = [];
```

The decoration cache now needs the letter's seed, so it can no longer be a plain `GlyphCache` keyed on char and depth — two letters of the same character must get different run selections. Build the blueprint per letter instead:

```ts
    const decoration = spec.decoration;
    this.decorOpacity = decoration?.look.opacity ?? 1;
    this.chunkGeo = decoration?.kind === 'chunks' ? chunkGeometry(decoration.shape) : null;
    this.decorCache =
      decoration && decoration.kind !== 'tube'
        ? new GlyphCache<Blueprint>((char, depth) =>
            buildChunkBlueprint(this.cache.get(char, depth)),
          )
        : null;
```

Then in the per-letter branch, replace the `blueprint.kind === 'tube'` arm:

```ts
        if (decoration && decoration.kind === 'tube') {
          const decorMaterial = createMaterial();
          applyLook(
            decorMaterial,
            decoration.look,
            tintMaterialOf(spec) === 'decoration' ? tint : undefined,
          );
          decorMaterial.transparent = true;
          this.decorMaterials.push(decorMaterial);

          const darkMaterial = createMaterial();
          applyLook(darkMaterial, decoration.dark);
          darkMaterial.transparent = true;
          this.darkMaterials.push(darkMaterial);

          const blueprint = buildTubeBlueprint(
            glyphToShapes(font.font, g.char, EM),
            decoration,
            DEFAULT_GLYPH_OPTIONS.depth,
            this.letters.length,
          );
          this.tubeBlueprints.push(blueprint);
          for (const geo of blueprint.lit) cell.add(new THREE.Mesh(geo, decorMaterial));
          for (const geo of blueprint.dark) cell.add(new THREE.Mesh(geo, darkMaterial));
        } else if (decoration && this.decorCache) {
          // ... existing chunks branch unchanged
        } else {
          this.decorMaterials.push(null);
          this.darkMaterials.push(null);
        }
```

Add the blueprint store and dispose them:

```ts
  private readonly tubeBlueprints: TubeBlueprint[] = [];
```

In `dispose()`, alongside the existing material disposal:

```ts
    for (const blueprint of this.tubeBlueprints) blueprint.dispose();
    this.tubeBlueprints.length = 0;
    for (const material of this.darkMaterials) material?.dispose();
```

In `apply()`, wherever `decorMaterials[i].opacity` is written, write `darkMaterials[i].opacity` the same way — an unlit run must fade with the letter or it hangs in the air during an exit.

- [ ] **Step 5: Export the new types**

In `packages/core/src/index.ts`, extend the decoration export line:

```ts
export type { DecorationSpec, MaterialSpec } from './render/decoration.js';
export type { Run, SelectSpec, SurfaceKind, TubeSpec } from './render/tube/index.js';
```

- [ ] **Step 6: Run the full suite**

Run: `npm run check`
Expected: PASS — lint clean, all vitest files green

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/render/looks.ts packages/core/src/render/word.ts \
  packages/core/src/index.ts packages/core/test/render/looks.test.ts
git commit -m "build tubing from the run pipeline and light its dark glass"
```

---

### Task 10: Lab sliders

**Files:**
- Modify: `apps/lab/index.html:51-53` (tube sliders)
- Modify: `apps/lab/src/main.ts:145-152` (the tube branch of `chosenLook`)

- [ ] **Step 1: Replace the tube sliders in `index.html`**

Delete the `tubeAt` and `inset` rows. Keep `radius`. Add:

```html
      <label>tube radius <input id="radius" type="range" min="1" max="120" step="1" value="45" /></label>
      <label>tube level <input id="level" type="range" min="-120" max="120" step="1" value="0" /></label>
      <label>tube runs <input id="tubeRuns" type="range" min="1" max="24" step="1" value="7" /></label>
      <label>tube min run <input id="minRun" type="range" min="10" max="600" step="5" value="150" /></label>
      <label>tube lit <input id="lit" type="range" min="0" max="100" step="1" value="85" /></label>
      <label>wall depth <input id="wallDepth" type="range" min="0" max="100" step="5" value="50" /></label>
      <label>wall rise <input id="wallRise" type="range" min="0" max="100" step="5" value="0" /></label>
```

- [ ] **Step 2: Add a surface picker to `index.html`**

Beside the sliders:

```html
      <label>surfaces
        <select id="surfaces">
          <option value="front">front</option>
          <option value="front,wall">front + wall</option>
          <option value="front,back">front + back</option>
          <option value="front,back,wall">all three</option>
        </select>
      </label>
```

- [ ] **Step 3: Rewrite the tube branch of `chosenLook`**

```ts
  const decoration = spec.decoration;
  if (decoration?.kind === 'tube') {
    tuned.decoration = {
      ...decoration,
      radius: number('radius') / 1000,
      level: number('level') / 1000,
      runs: number('tubeRuns'),
      minRun: number('minRun') / 1000,
      wallDepth: number('wallDepth') / 100,
      wallRise: number('wallRise') / 100,
      surfaces: (el('surfaces') as HTMLSelectElement).value.split(',') as SurfaceKind[],
      select: { ...decoration.select, amount: number('lit') / 100 },
    };
  } else if (decoration?.kind === 'chunks') {
```

Import the type at the top of `main.ts`:

```ts
import type { SurfaceKind } from '@blitsklieg/core';
```

- [ ] **Step 4: Verify by eye**

Run: `npm run dev -w @blitsklieg/lab`
Pick `tubing`. Drag `tube level` from −120 to +120 and confirm paths inset, ride the outline, then stand off, dropping out entirely at the extremes rather than throwing. Drag `tube runs` and confirm the count changes and gaps appear. Switch `surfaces` to "front + wall" and confirm tube appears around the letter edge. Check the browser console is clean.

- [ ] **Step 5: Commit**

```bash
git add apps/lab/index.html apps/lab/src/main.ts
git commit -m "give the lab sliders for level, runs, floor, lit fraction and surfaces"
```

---

### Task 11: Re-record the visual baseline

**Files:**
- Modify: `apps/lab/test/looks.spec.ts-snapshots/look-tubing-darwin.png`

- [ ] **Step 1: Run the visual suite and watch it fail**

Run: `npm run test:visual`
Expected: FAIL on `look-tubing` only. If any other look fails, stop — nothing in this branch touches them, and a second failure means the change leaked.

- [ ] **Step 2: Re-record**

`--update-snapshots=all` rewrites **every** baseline including looks this change cannot touch, because the environment map is generated at runtime and `maxDiffPixelRatio` is 0.15. So re-record, then revert everything except tubing:

```bash
npx playwright test --update-snapshots=all
git checkout -- apps/lab/test/looks.spec.ts-snapshots/
git checkout HEAD -- apps/lab/test/looks.spec.ts-snapshots/look-tubing-darwin.png 2>/dev/null || true
npx playwright test --update-snapshots=all --grep tubing
```

- [ ] **Step 3: Confirm only tubing moved**

Run: `git status --short apps/lab/test/looks.spec.ts-snapshots/`
Expected: exactly one modified file, `look-tubing-darwin.png`

- [ ] **Step 4: Look at it**

Run: `open apps/lab/test/looks.spec.ts-snapshots/look-tubing-darwin.png`
Expected: separate runs of glowing tube with visible gaps and dark glass between them — not a continuous outline.

- [ ] **Step 5: Run everything**

Run: `npm run check && npm run test:visual`
Expected: PASS both

- [ ] **Step 6: Commit**

```bash
git add apps/lab/test/looks.spec.ts-snapshots/look-tubing-darwin.png
git commit -m "re-record the tubing baseline for the run pipeline"
```

---

## Notes for the implementer

**`maxDiffPixelRatio: 0.15` is too loose to catch a real render change.** A green visual run is not evidence that nothing moved. Bloom turning on did not fail the `neon` baseline historically, and neither did roughly doubling the visible sequins.

**A bloomed look at DPR 2 can exhaust Playwright's default screenshot budget.** `shoot()` passes `timeout: 20000` for this reason. A tubing baseline timeout is that, not instability.

**Never add `opacity` to `LookKey`.** `Word` rewrites `material.opacity` every frame from the pose, so a value applied through `PARAM_KEYS` is gone by the first tick. There is a comment at the declaration saying so.

**Task 9 changes tube blueprint caching from per-character to per-letter.** That is deliberate: two `O`s in a word must not get identical run selections. It costs one field build per letter. If that measures badly, cache on `char + seed` rather than reverting to `char`.
