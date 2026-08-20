# Tube Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tube one diameter. Replace the per-run radius clamp with a minimum bend radius
that constrains the *path*, and rebuild the loop as a pigtail that advances instead of landing back
on itself.

**Architecture:** A new `bend.ts` owns everything that measures or reshapes a path by bend radius —
classification, fillets, and the clearance query — so `runs.ts` keeps its job of cutting and
stitching. `sweep.ts` stops shrinking and starts reporting. The invariant the whole change buys is
that **`sweepRun` sweeps at the requested radius, always**; the only backstop for a path that still
cannot carry it is a break, never a shrink.

**Tech Stack:** TypeScript, three.js, vitest, Playwright for visual baselines.

**Spec:** `docs/superpowers/specs/2026-08-19-tube-geometry-design.md`. Read it first — it carries the
model and the reasoning; this plan carries the steps. The three decisions it once left open are
settled in its `## Settled` section: `bend` defaults to 2, the pigtail winds in the depth plane, and
the clearance query ships in v1.

---

## What the alphabet sweep changed

`spikes/alphabet-sweep.mjs` measured all 26 letters after the spec was written, and three of its
findings shape this plan rather than merely decorating it.

**Filleting is the ordinary path.** At `bend = 2` there are 228 hard corners on `tubing` and 244 on
`piping`, spread over **all 26 glyphs in both looks**. Code that is correct but fragile in the fillet
path will be exercised on essentially every letter, so Task 3 is the one to be conservative in, and
the clearance query in Task 4 runs on nearly every corner of every letter rather than rarely — a
test 5% too eager will break-fallback its way through the alphabet.

**`ρmin` is above `ρstyle`, and that breaks the spec's two-class model.** `ρstyle` is `1.76 r` and
`ρmin` is `bend · r`, so at any `bend` above 1.76 the "stylistic" band `ρmin ≤ ρ < ρstyle` is
**empty** — every detected corner is hard. Worse, the band the other side of it is not: a corner
between `ρstyle` and `ρmin` is hard, but sits above the detection threshold and so is **never
detected and never fixed**. Measured, at `bend = 2` that silently strands 13 hard corners on
`tubing` and 11 on `piping`; at `bend = 3`, 174 on `tubing`. Task 7's invariant would fail on exactly
those and the cause would not be visible in the corner code.

**Detection must therefore run at `max(ρstyle, ρmin)`,** which is what Task 2 implements. Every
number above is measured at that threshold. The `hard` flag stays on `Corner` because the strategy
draw still reads it, but be aware it is `true` for every corner at the shipped `bend` — if a later
change wants a genuinely stylistic class it has to lower `bend` below 1.76, not adjust `ρstyle`.

**`bend` does not classify — it sets setback.** `bend = 2` and `bend = 3` produce almost identical
hard-corner counts, because the glyphs' corners sit at 0.3–0.7 of the tube's own radius, far below
any admissible `ρmin`. What moving `bend` changes is how far a fillet cuts back, and therefore how
many fillets have no room: 8 on `tubing` and 7 on `piping` at `bend = 2`. Do not expect the corner
counts to move when tuning `bend` in the lab; watch the rejection count.

**`M` and `W` are the worst case, not `N`.** The standing `NSRE` test string misses both extremes.
Every acceptance check below uses `MWNSRE`.

## File structure

- **Create** `packages/core/src/render/tube/bend.ts` — bend-radius measurement, corner
  classification, fillet construction, and the clearance grid. Pure geometry, no three.js scene
  types beyond `Vector3`.
- **Create** `packages/core/test/render/tube/bend.test.ts`.
- **Modify** `packages/core/src/render/tube/runs.ts` — corner detection delegates to `bend.ts`;
  `connect` fillets; `loop` builds a pigtail; `DEFAULT_CORNER` and `CONNECT_LIMIT` are deleted.
- **Modify** `packages/core/src/render/tube/sweep.ts` — `sweepRadius` returns the tightest bend
  radius as a diagnostic; `sweepRun` sweeps at the requested radius.
- **Modify** `packages/core/src/render/tube/wander.ts` — clamp per-run amplitude so wander cannot
  breach `ρmin`.
- **Modify** `packages/core/src/render/tube/index.ts` — the `bend` spec field.
- **Modify** `packages/core/src/render/looks.ts` — `bend` on both shipped looks.
- **Modify** `packages/core/dev/tube-lab/src/report.ts` — the clamp predicate changes meaning.
  **Coordinate:** this file is in the tube-lab session's Task 9 file set. Rebase before touching it.
- **Modify** `spikes/clamp-vs-blur.mjs` — its percentage becomes a `ρ/r` ratio.

---

### Task 1: The `bend` field and its floor

A pure addition. Nothing changes shape yet; this only makes `ρmin` reachable.

**Files:**
- Create: `packages/core/src/render/tube/bend.ts`
- Create: `packages/core/test/render/tube/bend.test.ts`
- Modify: `packages/core/src/render/tube/index.ts`, `packages/core/src/render/looks.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/render/tube/bend.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BEND_FLOOR, DEFAULT_BEND, minBendRadius } from '../../../src/render/tube/bend.js';

describe('minBendRadius', () => {
  it('is bend times the tube radius', () => {
    expect(minBendRadius(0.022, 2)).toBeCloseTo(0.044, 6);
  });

  it('defaults to DEFAULT_BEND when the spec sets none', () => {
    expect(minBendRadius(0.022, undefined)).toBeCloseTo(0.022 * DEFAULT_BEND, 6);
  });

  // The mesh turns inside out below 1/CLEARANCE, whatever the look claims about its material.
  it('floors a bend below the point the sweep self-intersects', () => {
    expect(minBendRadius(0.022, 0.5)).toBeCloseTo(0.022 * BEND_FLOOR, 6);
    expect(BEND_FLOOR).toBeCloseTo(1.25, 6);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/bend.test.ts`
Expected: FAIL — cannot resolve `../../../src/render/tube/bend.js`.

- [ ] **Step 3: Write `bend.ts`**

Create `packages/core/src/render/tube/bend.ts`:

```ts
import type * as THREE from 'three';

/**
 * The floor on `bend`, inherited from the sweep's old CLEARANCE of 0.8: a tube may occupy at most
 * that fraction of its path's curvature radius before the inner wall passes through itself.
 */
export const BEND_FLOOR = 1.25;
export const DEFAULT_BEND = 2;

/** Minimum bend radius in em. `bend` is a multiple of `radius`, so changing radius cannot break it. */
export function minBendRadius(radius: number, bend: number | undefined): number {
  return radius * Math.max(BEND_FLOOR, bend ?? DEFAULT_BEND);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/bend.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the spec field**

In `packages/core/src/render/tube/index.ts`, inside `TubeSpec`, after `radius`:

```ts
  /**
   * Minimum bend radius as a multiple of `radius` — how tightly this material bends relative to its
   * own thickness. Floored at 1.25, below which the swept mesh self-intersects whatever the look asks.
   */
  bend?: number;
```

In `packages/core/src/render/looks.ts`, add `bend: 2,` to `tubing.decoration` after `radius: 0.022,`
and to `piping.decoration` after `radius: 0.03,`.

- [ ] **Step 6: Verify by mutation**

Change `BEND_FLOOR` to `1.0` and re-run the suite. The third test must fail. Change it back.
A test that passes at both values is not testing the floor.

- [ ] **Step 7: Run the check and commit**

```bash
npm run check
git add packages/core/src/render/tube/bend.ts packages/core/test/render/tube/bend.test.ts \
        packages/core/src/render/tube/index.ts packages/core/src/render/looks.ts
git commit -m "give the tube a minimum bend radius as a material property"
```

---

### Task 2: Classify corners by bend radius

`DEFAULT_CORNER = π/6` is a bend-radius test in disguise: at the shipped `spacing 0.02` and
`radius 0.022` it fires at exactly `ρ < 1.76 r`. Stating it as a bend radius costs nothing and makes
it respond to both knobs instead of neither.

**Files:**
- Modify: `packages/core/src/render/tube/bend.ts`, `packages/core/test/render/tube/bend.test.ts`
- Modify: `packages/core/src/render/tube/runs.ts`

- [ ] **Step 1: Write the failing test**

Append to `bend.test.ts`:

```ts
import * as THREE from 'three';
import { cornersByBend, vertexBends } from '../../../src/render/tube/bend.js';

/** A polyline turning by `turn` once, at its middle vertex, with uniform segment length `step`. */
function elbow(turn: number, step: number): THREE.Vector3[] {
  const mid = new THREE.Vector3(0, 0, 0);
  const back = new THREE.Vector3(-step, 0, 0);
  const fwd = new THREE.Vector3(Math.cos(turn) * step, Math.sin(turn) * step, 0);
  return [back.clone().multiplyScalar(2), back, mid, fwd, fwd.clone().multiplyScalar(2)];
}

describe('vertexBends', () => {
  // rho = s / (2 sin(theta/2)) is the circumradius of three points spaced s apart turning by theta.
  it('measures a turn as its bend radius', () => {
    const bends = vertexBends(elbow(Math.PI / 3, 0.02), false);
    const corner = bends.find((b) => b.turn > 1e-6);
    expect(corner?.rho).toBeCloseTo(0.02 / (2 * Math.sin(Math.PI / 6)), 5);
  });

  it('reports a straight run as unbounded', () => {
    const straight = [0, 1, 2, 3].map((i) => new THREE.Vector3(i * 0.02, 0, 0));
    for (const b of vertexBends(straight, false)) expect(b.rho).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('cornersByBend', () => {
  it('splits hard from stylistic at rhoMin', () => {
    const points = elbow(Math.PI / 2, 0.02);
    const rho = 0.02 / (2 * Math.sin(Math.PI / 4));
    const hard = cornersByBend(points, false, rho * 1.5, rho * 3);
    expect(hard[0]?.hard).toBe(true);
    const soft = cornersByBend(points, false, rho * 0.5, rho * 3);
    expect(soft[0]?.hard).toBe(false);
  });

  it('ignores a turn gentler than the detection threshold', () => {
    expect(cornersByBend(elbow(0.01, 0.02), false, 0.001, 0.002)).toEqual([]);
  });

  // rhoStyle is 1.76r and rhoMin is bend*r, so above bend 1.76 the detection threshold has to be
  // rhoMin or hard corners between the two are never seen. Measured, that strands 13 of them on
  // tubing at bend 2 and 174 at bend 3.
  it('detects a hard corner sitting above rhoStyle', () => {
    const points = elbow(Math.PI / 2, 0.02);
    const rho = 0.02 / (2 * Math.sin(Math.PI / 4));
    const found = cornersByBend(points, false, rho * 2, rho * 0.5);
    expect(found.length).toBe(1);
    expect(found[0]?.hard).toBe(true);
  });

  // A curve sampled finely is many vertices all below the threshold; it is one corner, not twelve.
  it('collapses a consecutive stretch to its tightest vertex', () => {
    const arc: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * Math.PI;
      arc.push(new THREE.Vector3(Math.cos(t) * 0.05, Math.sin(t) * 0.05, 0));
    }
    expect(cornersByBend(arc, false, 1, 1).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/bend.test.ts`
Expected: FAIL — `vertexBends` and `cornersByBend` are not exported.

- [ ] **Step 3: Implement them**

Append to `packages/core/src/render/tube/bend.ts`:

```ts
/** `DEFAULT_CORNER = PI/6` restated as a bend radius, at the shipped spacing and radius. */
export const STYLE_FACTOR = 1.76;

export interface VertexBend {
  index: number;
  /** Direction change at this vertex, in radians. */
  turn: number;
  /** Bend radius the path takes here, in em. Infinite on a straight stretch. */
  rho: number;
  /** Mean of the two adjacent segment lengths — the `s` in `s / (2 sin(theta/2))`. */
  step: number;
}

export interface Corner extends VertexBend {
  /** Below `rhoMin`: the material physically cannot go round it. */
  hard: boolean;
}

/**
 * Every vertex's bend radius. A closed path tests every index, wrapping at the seam; an open path
 * never treats its own endpoints as corners, since they have no incoming or outgoing leg.
 */
export function vertexBends(points: THREE.Vector3[], closed: boolean): VertexBend[] {
  const n = points.length;
  if (n < 3) return [];
  const out: VertexBend[] = [];
  const count = closed ? n : n - 2;
  const first = closed ? 0 : 1;
  for (let k = 0; k < count; k++) {
    const i = first + k;
    const prev = points[(i - 1 + n) % n] as THREE.Vector3;
    const cur = points[i] as THREE.Vector3;
    const next = points[(i + 1) % n] as THREE.Vector3;
    const a = cur.clone().sub(prev);
    const b = next.clone().sub(cur);
    if (a.lengthSq() < 1e-18 || b.lengthSq() < 1e-18) continue;
    const step = (a.length() + b.length()) / 2;
    const turn = a.normalize().angleTo(b.normalize());
    const rho = turn < 1e-9 ? Number.POSITIVE_INFINITY : step / (2 * Math.sin(turn / 2));
    out.push({ index: i, turn, rho, step });
  }
  return out;
}

/**
 * Corners tighter than `rhoStyle`, each consecutive stretch collapsed to its tightest vertex, and
 * flagged `hard` below `rhoMin`.
 */
export function cornersByBend(
  points: THREE.Vector3[],
  closed: boolean,
  rhoMin: number,
  rhoStyle: number,
): Corner[] {
  // Detect at whichever threshold is higher. A corner below rhoMin is hard whatever rhoStyle says,
  // and one missed here is never fixed by any later stage — the invariant fails with no local cause.
  const detect = Math.max(rhoMin, rhoStyle);
  const hits = vertexBends(points, closed).filter((b) => b.rho < detect);
  if (hits.length === 0) return [];
  const groups: VertexBend[][] = [[hits[0] as VertexBend]];
  for (let k = 1; k < hits.length; k++) {
    const hit = hits[k] as VertexBend;
    const group = groups[groups.length - 1] as VertexBend[];
    const prev = group[group.length - 1] as VertexBend;
    if (hit.index === prev.index + 1) group.push(hit);
    else groups.push([hit]);
  }
  // A corner straddling a closed path's seam splits into a group ending at n-1 and one starting at
  // 0; they are adjacent by wraparound and are one corner.
  if (closed && groups.length > 1) {
    const head = groups[0] as VertexBend[];
    const tail = groups[groups.length - 1] as VertexBend[];
    if (head[0]?.index === 0 && tail[tail.length - 1]?.index === points.length - 1) {
      groups[0] = tail.concat(head);
      groups.pop();
    }
  }
  return groups
    .map((g) => g.reduce((a, b) => (b.rho < a.rho ? b : a)))
    .map((b) => ({ ...b, hard: b.rho < rhoMin }));
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/bend.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Route `runs.ts` through it**

In `runs.ts`, delete `DEFAULT_CORNER` and the whole `cornersOf` function. Import from `bend.js`:

```ts
import { type Corner, cornersByBend, minBendRadius, STYLE_FACTOR } from './bend.js';
```

`CornerInfo` becomes `Corner`. In `rawSpansOf`, replace the `angle` parameter with `rhoMin` and
`rhoStyle`, and its body's `cornersOf(points, closed, angle)` with
`cornersByBend(points, closed, rhoMin, rhoStyle)`. In `cutIntoRuns`, compute them once:

```ts
  const radius = opts.radius ?? FALLBACK_RADIUS;
  const rhoMin = minBendRadius(radius, opts.bend);
  const rhoStyle = radius * STYLE_FACTOR;
```

and pass them to `rawSpansOf(path, rhoMin, rhoStyle)`. Add `bend?: number;` to `CutOptions` with the
same doc comment as the spec field, and pass `bend: spec.bend` from `buildTubeBlueprint` in
`index.ts`.

- [ ] **Step 6: Verify by mutation**

Set `STYLE_FACTOR` to `0.5` and run the full suite. Tests that assert run counts on real glyphs must
fail — if they all still pass, nothing is checking that corner detection reaches real letters, and
that gap is the bug. Restore it.

- [ ] **Step 7: Run the check and commit**

```bash
npm run check
```

**This step is not behaviour-preserving, and that is deliberate.** `STYLE_FACTOR = 1.76` reproduces
`DEFAULT_CORNER` exactly at the shipped spacing, but detection runs at `max(ρmin, ρstyle)` = `2 r`,
which is wider — 16 more corners on `tubing`, 17 on `piping`. Run counts and therefore run colours
will move on real glyphs, and a test asserting either will fail legitimately.

Update those assertions to the new counts, but only after confirming the *direction* is right: more
corners detected, never fewer. Fewer means the threshold went the wrong way.

```bash
git add packages/core/src/render/tube/bend.ts packages/core/test/render/tube/bend.test.ts \
        packages/core/src/render/tube/runs.ts packages/core/src/render/tube/index.ts
git commit -m "classify tube corners by bend radius instead of by turn angle"
```

---

### Task 3: `connect` becomes a real fillet

`connect` currently merges two arcs and leaves the corner vertex where it was, which is why a
connected corner is still a kink. It becomes the bender's actual move: a circular arc of radius
`ρmin` tangent to both legs.

**Files:**
- Modify: `packages/core/src/render/tube/bend.ts`, `packages/core/test/render/tube/bend.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `bend.test.ts`:

```ts
import { filletAt } from '../../../src/render/tube/bend.js';
import { minCurvatureRadius3 } from '../../../src/render/tube/resample.js';

describe('filletAt', () => {
  const RHO = 0.044;

  it('replaces the corner with an arc at rhoMin', () => {
    const points = elbow(Math.PI / 2, 0.02);
    const fillet = filletAt(points, false, 2, RHO, 0.02);
    expect(fillet).not.toBeNull();
    const measured = minCurvatureRadius3(
      (fillet as { points: THREE.Vector3[] }).points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    );
    // Discrete sampling reads a shade under the true arc radius; 10% is the sampling error, not slack.
    expect(measured).toBeGreaterThan(RHO * 0.9);
  });

  it('sets back by rhoMin * tan(theta/2) along each leg', () => {
    const turn = Math.PI / 2;
    const fillet = filletAt(elbow(turn, 0.02), false, 2, RHO, 0.02);
    expect((fillet as { setback: number }).setback).toBeCloseTo(RHO * Math.tan(turn / 2), 5);
  });

  // Room test: a leg shorter than the setback cannot carry the fillet.
  it('refuses a fillet with no room on its legs', () => {
    expect(filletAt(elbow(Math.PI / 2, 0.002), false, 2, RHO, 0.02)).toBeNull();
  });

  it('leaves the path continuous at both joins', () => {
    const points = elbow(Math.PI / 3, 0.02);
    const fillet = filletAt(points, false, 2, RHO * 0.2, 0.02);
    const { points: arc } = fillet as { points: THREE.Vector3[] };
    const first = arc[0] as THREE.Vector3;
    const last = arc[arc.length - 1] as THREE.Vector3;
    // Both tangent points sit on their own leg, so each is collinear with that leg's direction.
    expect(first.distanceTo(points[2] as THREE.Vector3)).toBeLessThan(
      (points[2] as THREE.Vector3).distanceTo(points[1] as THREE.Vector3) + 1e-9,
    );
    expect(last.distanceTo(points[2] as THREE.Vector3)).toBeLessThan(
      (points[2] as THREE.Vector3).distanceTo(points[3] as THREE.Vector3) + 1e-9,
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/bend.test.ts`
Expected: FAIL — `filletAt` is not exported.

- [ ] **Step 3: Implement `filletAt`**

Append to `bend.ts`:

```ts
import * as THREE from 'three';

export interface Fillet {
  /** Replacement points from the incoming tangent point to the outgoing one, inclusive. */
  points: THREE.Vector3[];
  /** Distance back along each leg to the tangent point. */
  setback: number;
  /** Index of the corner vertex these points replace. */
  index: number;
}

/**
 * A circular arc of radius `rhoMin` tangent to both legs at `index`, resampled at `spacing`.
 * Returns null when either leg is shorter than the setback — the caller falls back to a break.
 */
export function filletAt(
  points: THREE.Vector3[],
  closed: boolean,
  index: number,
  rhoMin: number,
  spacing: number,
): Fillet | null {
  const n = points.length;
  const prev = points[(index - 1 + n) % n] as THREE.Vector3 | undefined;
  const cur = points[index] as THREE.Vector3 | undefined;
  const next = points[(index + 1) % n] as THREE.Vector3 | undefined;
  if (!prev || !cur || !next) return null;

  const into = cur.clone().sub(prev);
  const outOf = next.clone().sub(cur);
  if (into.lengthSq() < 1e-18 || outOf.lengthSq() < 1e-18) return null;
  const u = into.clone().normalize();
  const v = outOf.clone().normalize();
  const turn = u.angleTo(v);
  // A straight join needs no fillet; a full reversal has no arc that meets both legs.
  if (turn < 1e-6 || turn > Math.PI - 1e-6) return null;

  const setback = rhoMin * Math.tan(turn / 2);
  if (setback > into.length() || setback > outOf.length()) return null;

  const start = cur.clone().addScaledVector(u, -setback);
  const end = cur.clone().addScaledVector(v, setback);
  // The arc's center sits off the corner along the internal bisector, at rhoMin / cos(turn/2).
  const bisector = v.clone().sub(u).normalize();
  const center = cur.clone().addScaledVector(bisector, rhoMin / Math.cos(turn / 2));

  const radial0 = start.clone().sub(center);
  const radial1 = end.clone().sub(center);
  const axis = radial0.clone().cross(radial1);
  if (axis.lengthSq() < 1e-18) return null;
  axis.normalize();

  const sweep = radial0.angleTo(radial1);
  const steps = Math.max(2, Math.ceil((sweep * rhoMin) / spacing));
  const arc: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const spoke = radial0.clone().applyAxisAngle(axis, (i / steps) * sweep);
    arc.push(center.clone().add(spoke));
  }
  return { points: arc, setback, index };
}
```

Note `bend.ts` now imports `* as THREE` rather than `type * as THREE`; update the top-of-file import.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/bend.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Verify by mutation**

Three separate mutations, each of which must break at least one test:

1. Return `rhoMin * Math.tan(turn)` for `setback` — the setback assertion must fail.
2. Drop the `setback > into.length()` guard — the room test must fail.
3. Place the center at `rhoMin` along the bisector instead of `rhoMin / cos(turn/2)` — the arc
   radius assertion must fail.

If any mutation passes, that test is not testing what it claims. Restore after each.

- [ ] **Step 6: Run the check and commit**

```bash
npm run check
git add packages/core/src/render/tube/bend.ts packages/core/test/render/tube/bend.test.ts
git commit -m "build a corner fillet as a tangent arc at the minimum bend radius"
```

---

### Task 4: The clearance query

A convex fillet moves the path toward the letter's body and can meet the far wall of a thin stem; a
concave one moves it outward into a counter. **The test must be relative, not absolute** — runs
already pass within `2r` of each other in tight counters at the shipped radius, so an absolute test
would veto fillets precisely where they change nothing.

**Files:**
- Modify: `packages/core/src/render/tube/bend.ts`, `packages/core/test/render/tube/bend.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `bend.test.ts`:

```ts
import { ClearanceGrid } from '../../../src/render/tube/bend.js';

describe('ClearanceGrid', () => {
  const line = (n: number, y: number) =>
    Array.from({ length: n }, (_, i) => new THREE.Vector3(i * 0.02, y, 0));

  it('finds the nearest point outside an arc-length exclusion', () => {
    const grid = new ClearanceGrid(0.05);
    grid.add(line(20, 0), 0);
    // A probe on the same path, far along it, is excluded by arc length rather than by distance.
    expect(grid.nearest(new THREE.Vector3(0.1, 0, 0), 0, 0.1)).toBe(Number.POSITIVE_INFINITY);
  });

  it('measures distance to a genuinely separate path', () => {
    const grid = new ClearanceGrid(0.05);
    grid.add(line(20, 0), 0);
    grid.add(line(20, 0.03), 1);
    expect(grid.nearest(new THREE.Vector3(0.1, 0, 0), 0, 0.1)).toBeCloseTo(0.03, 3);
  });

  it('is empty when nothing is within the cell radius', () => {
    const grid = new ClearanceGrid(0.05);
    grid.add(line(20, 0), 0);
    expect(grid.nearest(new THREE.Vector3(0, 5, 0), 1, 0.1)).toBe(Number.POSITIVE_INFINITY);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/bend.test.ts`
Expected: FAIL — `ClearanceGrid` is not exported.

- [ ] **Step 3: Implement it**

Append to `bend.ts`:

```ts
interface GridEntry {
  point: THREE.Vector3;
  path: number;
  /** Cumulative arc length along its own path, for the same-path exclusion. */
  along: number;
}

/**
 * A uniform spatial hash over every path point, answering "what is the nearest piece of tube that
 * is not this piece". Cell size should be the query radius, so a query touches 27 cells.
 */
export class ClearanceGrid {
  private readonly cells = new Map<string, GridEntry[]>();

  constructor(private readonly cell: number) {}

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }

  add(points: THREE.Vector3[], path: number): void {
    let along = 0;
    for (let i = 0; i < points.length; i++) {
      const point = points[i] as THREE.Vector3;
      if (i > 0) along += point.distanceTo(points[i - 1] as THREE.Vector3);
      const k = this.key(point.x, point.y, point.z);
      const bucket = this.cells.get(k);
      if (bucket) bucket.push({ point, path, along });
      else this.cells.set(k, [{ point, path, along }]);
    }
  }

  /**
   * Distance to the nearest point that is either on another path, or far enough along this one to
   * be a genuinely different piece of tube. Infinite when nothing qualifies within one cell.
   */
  nearest(probe: THREE.Vector3, path: number, along: number, skip = 0.09): number {
    let best = Number.POSITIVE_INFINITY;
    const cx = Math.floor(probe.x / this.cell);
    const cy = Math.floor(probe.y / this.cell);
    const cz = Math.floor(probe.z / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const entry of bucket) {
            if (entry.path === path && Math.abs(entry.along - along) < skip) continue;
            best = Math.min(best, probe.distanceTo(entry.point));
          }
        }
      }
    }
    return best;
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/bend.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Verify by mutation**

Delete the `entry.path === path` arc-length exclusion. The first test must fail — without it, every
probe finds itself at distance zero and no fillet ever passes. Restore it.

- [ ] **Step 6: Run the check and commit**

```bash
npm run check
git add packages/core/src/render/tube/bend.ts packages/core/test/render/tube/bend.test.ts
git commit -m "add a spatial hash answering what tube a fillet would collide with"
```

---

### Task 5: Bound wander so it cannot breach the invariant

`wanderFaceRuns` mutates run points *after* `cutIntoRuns` and after `assign`, so nothing downstream
re-checks its curvature. **It genuinely violates `ρmin` today**: `tubing` ships `amplitude: 0.02` and
`minRun: 0.15`, and a two-lobe wander on a run at that floor bends at 0.033 against a `ρmin` of
0.044.

The contribution has a closed form. Wander adds `z = A·scale·sin(s·π·lobes)` over a run of arc
length `T`; peak curvature is at the crest, where the slope term vanishes, so the bend radius is
exactly `T² / (A·scale·π²·lobes²)`. Every term is already in hand where wander runs, so it clamps
its own amplitude — **no reordering, and `run.index` keeps seeding it**.

Two derivations agree on this formula. Do not re-derive it; test it.

**Files:**
- Modify: `packages/core/src/render/tube/wander.ts`
- Create: `packages/core/test/render/tube/wander.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/render/tube/wander.test.ts`:

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { minCurvatureRadius3 } from '../../../src/render/tube/resample.js';
import type { Run } from '../../../src/render/tube/runs.js';
import { wanderFaceRuns } from '../../../src/render/tube/wander.js';

function frontRun(length: number, spacing: number, index: number): Run {
  const n = Math.max(3, Math.round(length / spacing) + 1);
  const points = Array.from(
    { length: n },
    (_, i) => new THREE.Vector3((i / (n - 1)) * length, 0, 0),
  );
  return { points, surface: 'front', length, index, lit: true, color: 0 };
}

const bendOf = (run: Run) =>
  minCurvatureRadius3(run.points.map((p) => ({ x: p.x, y: p.y, z: p.z })));

describe('wanderFaceRuns', () => {
  // The shipped tubing numbers on the shortest run its own minRun permits.
  it('keeps a short run above rhoMin at the shipped amplitude', () => {
    const rhoMin = 0.044;
    for (let index = 0; index < 12; index++) {
      const run = frontRun(0.15, 0.02, index);
      wanderFaceRuns([run], 0.02, 0, rhoMin);
      expect(bendOf(run)).toBeGreaterThan(rhoMin);
    }
  });

  it('leaves a long run's wander untouched, since it never breaches', () => {
    const loose = frontRun(0.6, 0.02, 3);
    const capped = frontRun(0.6, 0.02, 3);
    wanderFaceRuns([loose], 0.02, 0, 0);
    wanderFaceRuns([capped], 0.02, 0, 0.044);
    for (let i = 0; i < loose.points.length; i++) {
      expect((capped.points[i] as THREE.Vector3).z).toBeCloseTo(
        (loose.points[i] as THREE.Vector3).z,
        9,
      );
    }
  });

  it('still pins both ends to their original z', () => {
    const run = frontRun(0.15, 0.02, 1);
    wanderFaceRuns([run], 0.02, 0, 0.044);
    expect((run.points[0] as THREE.Vector3).z).toBeCloseTo(0, 9);
    expect((run.points[run.points.length - 1] as THREE.Vector3).z).toBeCloseTo(0, 9);
  });

  it('does nothing at amplitude zero', () => {
    const run = frontRun(0.15, 0.02, 1);
    wanderFaceRuns([run], 0, 0, 0.044);
    for (const p of run.points) expect(p.z).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/wander.test.ts`
Expected: FAIL — the first test finds a bend radius near 0.033, below `rhoMin`.

- [ ] **Step 3: Add the cap**

In `wander.ts`, add `rhoMin: number` as a fourth parameter to `wanderFaceRuns`, and after `scale` is
drawn:

```ts
    // Wander is the last stage to touch a run's points, so nothing downstream re-checks its
    // curvature: a sinusoid's tightest bend is T^2 / (A * scale * pi^2 * lobes^2), at the crest.
    // Spending only half the margin leaves room for the path's own curvature, which does not add
    // linearly with this one.
    const budget = rhoMin * 2;
    const ceiling =
      budget > 0 ? total ** 2 / (budget * Math.PI ** 2 * lobes ** 2 * scale) : Number.POSITIVE_INFINITY;
    const reach = Math.min(amplitude, ceiling);
```

and use `reach` in place of `amplitude` in the displacement line.

In `index.ts`, pass it: `wanderFaceRuns(runs, spec.amplitude ?? 0, seed, minBendRadius(spec.radius, spec.bend));`

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/wander.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify by mutation**

Change `budget` from `rhoMin * 2` to `rhoMin * 100`. The first test must fail. A cap so generous it
never binds is not a cap.

- [ ] **Step 6: Run the check and commit**

```bash
npm run check
git add packages/core/src/render/tube/wander.ts packages/core/test/render/tube/wander.test.ts \
        packages/core/src/render/tube/index.ts
git commit -m "cap a run's wander so it cannot out-bend the tube it displaces"
```

---

### Task 6: Sweep at the requested radius, always

This is the task the whole change exists for. Diameter becomes an invariant of the blueprint rather
than an outcome of it.

**`sweepRadius`'s return value changes meaning**, from "the radius we will actually draw" to "the
run's tightest bend radius". Its two consumers compare it against `requested`, and under the new
meaning that comparison is between two different quantities — it would keep returning plausible
booleans while being wrong. Rename as you go so the mistake is unavailable.

**Files:**
- Modify: `packages/core/src/render/tube/sweep.ts`, `packages/core/test/render/tube/sweep.test.ts`
- Modify: `packages/core/dev/tube-lab/src/report.ts`, `packages/core/test/dev/tube-lab/report.test.ts`
- Modify: `spikes/clamp-vs-blur.mjs`

- [ ] **Step 1: Write the failing test**

Replace the three `sweepRadius` assertions in `packages/core/test/render/tube/sweep.test.ts` with:

```ts
  it('reports the run's tightest bend radius, not a radius to draw at', () => {
    // A quarter circle of radius 1, sampled finely: its bend radius is 1 everywhere.
    const run = arcRun(1, Math.PI / 2);
    expect(tightestBend(run)).toBeCloseTo(1, 2);
  });

  it('is unbounded on a straight run', () => {
    expect(tightestBend(straightRun())).toBe(Number.POSITIVE_INFINITY);
  });

  it('sweeps at the requested radius even where the path bends tighter', () => {
    const geo = sweepRun(arcRun(0.01, Math.PI / 2), 0.03, 8);
    expect(geo).not.toBeNull();
    const positions = (geo as THREE.BufferGeometry).getAttribute('position');
    // Ring 0's vertices all sit exactly `requested` from the first path point.
    const first = new THREE.Vector3(positions.getX(0), positions.getY(0), positions.getZ(0));
    const center = arcRun(0.01, Math.PI / 2).points[0] as THREE.Vector3;
    expect(first.distanceTo(center)).toBeCloseTo(0.03, 6);
  });
```

Add a `straightRun()` helper alongside the file's existing `arcRun`.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/sweep.test.ts`
Expected: FAIL — `tightestBend` does not exist, and the third test finds the swept radius shrunk to
0.008 rather than 0.03.

- [ ] **Step 3: Change `sweep.ts`**

Delete `CLEARANCE`. Rename `sweepRadius` to `tightestBend` and drop its `requested` parameter:

```ts
/**
 * The run's tightest bend radius, as a diagnostic. Nothing scales geometry by this any more — the
 * corner stage is what makes a path bendable, and a run it could not fix is broken rather than
 * thinned.
 */
export function tightestBend(run: Run): number {
  return minCurvatureRadius3(smoothedPoints(run));
}
```

In `sweepRun`, delete the `sweepRadius` call and the `radius <= 0` guard, and sweep at `requested`:

```ts
  const points = smoothedPoints(run);
  return buildTubeGeometry(points, requested, segments);
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the two consumers**

In `packages/core/dev/tube-lab/src/report.ts`, `RunReport`'s `requested`/`actual` pair becomes
`tightest`/`minimum`, and the predicate changes from "drawn thinner than asked" to "the corner stage
failed to make this bendable":

```ts
const tightest = drawable ? tightestBend(run) : 0;
// ...
  tightest,
  minimum: rhoMin,
  unresolved: drawable && tightest < rhoMin,
  dropped: !drawable,
```

Rename the panel's `clamped` label to `unresolved` to match. Update
`packages/core/test/dev/tube-lab/report.test.ts`'s three assertions the same way.

In `spikes/clamp-vs-blur.mjs`, `pct` becomes a `ρ/r` ratio rather than a percentage of requested —
under the new meaning that ratio is directly comparable to `bend`. Rewrite the header comment and the
column labels, or the output reads as the old percentage.

- [ ] **Step 6: Verify by mutation**

In `report.ts`, change `unresolved` back to `tightest < requested`-style logic by comparing against
the tube radius instead of `rhoMin`. The report test must fail. This is the exact silent-wrong-answer
the rename exists to prevent, so if it passes, the test is not covering the predicate.

- [ ] **Step 7: Run the check and commit**

```bash
npm run check
```

The unit suite must be green. **The Playwright suite will not be, and that is expected from here on**
— see Task 8. Do not run it yet.

```bash
git add packages/core/src/render/tube/sweep.ts packages/core/test/render/tube/sweep.test.ts \
        packages/core/dev/tube-lab/src/report.ts packages/core/test/dev/tube-lab/report.test.ts \
        spikes/clamp-vs-blur.mjs
git commit -m "sweep the tube at the radius it was asked for"
```

---

### Task 7: Fillet the hard corners, and break what will not fit

Tasks 3 and 4 built the pieces. This wires them into `cutIntoRuns` so a hard corner is actually
filleted, and the backstop for one that cannot be is a break.

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts`
- Modify: `packages/core/test/render/tube/runs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/tube/runs.test.ts`:

```ts
import { minBendRadius } from '../../../src/render/tube/bend.js';
import { tightestBend } from '../../../src/render/tube/sweep.js';

describe('cutIntoRuns corner handling', () => {
  // The acceptance criterion the whole model is for.
  it('leaves no run bending tighter than rhoMin on a real glyph', () => {
    const rhoMin = minBendRadius(0.022, 2);
    for (const ch of 'MWNSRE') {
      const { runs } = cutIntoRuns(pathsFor(ch), {
        runs: 7,
        minRun: 0.15,
        corners: { break: 0.55, connect: 0.3, loop: 0.15 },
        radius: 0.022,
        bend: 2,
        seed: 0,
      });
      for (const run of runs) {
        expect(tightestBend(run), `${ch} run ${run.index}`).toBeGreaterThanOrEqual(rhoMin * 0.95);
      }
    }
  });

  it('breaks a corner whose fillet has no room rather than filleting it anyway', () => {
    // Two corners a hair apart: the setbacks cannot both fit in the leg between them.
    const cramped = crampedPath();
    const { runs } = cutIntoRuns([cramped], {
      runs: 1,
      minRun: 0,
      corners: { break: 0, connect: 1, loop: 0 },
      radius: 0.022,
      bend: 2,
      seed: 0,
    });
    expect(runs.length).toBeGreaterThan(1);
  });
});
```

Add `pathsFor(ch)` and `crampedPath()` helpers to the file — `pathsFor` mirrors what
`spikes/alphabet-sweep.mjs` does with `surfacesOf` and `generatePaths` at the shipped tubing spec.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/runs.test.ts`
Expected: FAIL — runs on `M` and `W` bend far below `rhoMin`, since nothing fillets yet.

- [ ] **Step 3: Fillet in `stitchPath`**

A hard corner drawn `connect` calls `filletAt`. On null — no room — it falls back to `break`. Splice
the fillet's points in place of the corner vertex: drop the last `setback`-worth of points from
`target` and the first `setback`-worth from `next`, then append the arc. Delete `CONNECT_LIMIT` and
its use in `pickStrategy`: whether a corner can be connected is now whether its fillet fits, which is
a measurement rather than a guess.

A hard corner drawn `break` or whose fillet is refused breaks as it always did.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/runs.test.ts`
Expected: PASS.

- [ ] **Step 5: Check it against the whole alphabet**

```bash
npm run build -w blitsklieg
node spikes/alphabet-sweep.mjs --out sweep-after.md
grep -E "^bend " sweep-after.md
```

Expected: the `worst run` column reads 100% for every letter in both looks. Any letter below that is
a run the corner stage failed to resolve, and it is a bug in this task rather than an acceptable
residue.

- [ ] **Step 6: Verify by mutation**

Make `filletAt` return `null` unconditionally. The first test must fail on `M`. Restore it.

- [ ] **Step 7: Run the check and commit**

```bash
npm run check
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/runs.test.ts
git commit -m "fillet a corner the glass cannot turn, and break the ones that will not fit"
```

---

### Task 8: The pigtail advances

`buildLoop` splices a full turn and lands **exactly** back on the corner, where the incoming and
outgoing tube also pass — measured self-distance 0.002–0.007 em against a 0.044 diameter. Its plane
comes from `seedNormal`, which picks whichever axis is least parallel to the tangent, so it flips
discontinuously with stroke direction and one glyph gets both.

**A pigtail is a substitution, not an insertion.** Take the sub-path spanning `L` of arc length
across the corner and rebuild it: leave that axis through a bend of radius `ρmin`, wind one full turn
of radius `LOOP_RADIUS_FACTOR · r` about it, return through a matching bend. Net advance is `L` by
construction. **It winds in the depth plane** — settled, because the letter's silhouette is what a
sign look needs intact — with a cap against the extrusion depth rather than standing proud of it.

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts`, `packages/core/test/render/tube/runs.test.ts`

- [ ] **Step 1: Write the failing test**

The spec's five acceptance criteria, one test each:

```ts
describe('the pigtail', () => {
  const R = 0.022;
  const rhoMin = minBendRadius(R, 2);
  const pig = () => buildPigtail(straightSpan(0.4, 0.02), 10, R, rhoMin, 0.3);

  it('advances along the path instead of landing back on itself', () => {
    const { points } = pig();
    const start = points[0] as THREE.Vector3;
    const end = points[points.length - 1] as THREE.Vector3;
    expect(end.distanceTo(start)).toBeGreaterThan(2 * R);
  });

  it('never doubles back through itself', () => {
    const { points } = pig();
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 6; j < points.length; j++) {
        expect((points[i] as THREE.Vector3).distanceTo(points[j] as THREE.Vector3)).toBeGreaterThan(
          2 * R,
        );
      }
    }
  });

  // A bare helix fails here: at R = 4r and a pitch of 2r its tangent meets its own axis at 85deg.
  it('stays above rhoMin through both transitions', () => {
    const { points } = pig();
    expect(minCurvatureRadius3(points.map((p) => ({ x: p.x, y: p.y, z: p.z })))).toBeGreaterThan(
      rhoMin * 0.95,
    );
  });

  it('winds in the depth plane whatever the incoming direction', () => {
    for (const dir of [[1, 0, 0], [0, 1, 0], [0.6, 0.8, 0]]) {
      const { points } = buildPigtail(spanAlong(dir, 0.4, 0.02), 10, R, rhoMin, 0.3);
      const spread = points.map((p) => p.z);
      expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(R);
    }
  });

  it('stays inside the extrusion depth it is capped against', () => {
    const { points } = pig();
    for (const p of points) expect(Math.abs(p.z)).toBeLessThanOrEqual(0.3 + 1e-9);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/render/tube/runs.test.ts`
Expected: FAIL — `buildPigtail` does not exist.

- [ ] **Step 3: Replace `buildLoop` with `buildPigtail`**

Delete `buildLoop`, `LOOP_SEGMENTS` and the `seedNormal` import. `LOOP_RADIUS_FACTOR` stays as a
factor on `r`, justified now by `≥ ρmin` rather than by the deleted `CLEARANCE`. The winding axis is
the path tangent; the winding plane's normal is world `z` — the depth plane — rather than
`seedNormal(tangentIn)`. Sample by arc length at `spacing`, not at a fixed segment count, so the
spacing holds when `radius` moves. Cap the winding radius at `depth / 2` and fall back to `break`
when the cap would take it below `ρmin`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run packages/core/test/render/tube/runs.test.ts`
Expected: PASS, 5 pigtail tests.

- [ ] **Step 5: Verify by mutation**

Return the old `buildLoop` behaviour — land the last point back on the first. Tests 1 and 2 must both
fail. Then make the winding plane `seedNormal(tangent)` again; test 4 must fail on the axis-aligned
directions specifically.

- [ ] **Step 6: Run the check and commit**

```bash
npm run check
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/runs.test.ts
git commit -m "wind a loop into a pigtail that advances along the path"
```

---

### Task 9: Acceptance, and the four baselines

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-tube-geometry-design.md` (acceptance results only)

- [ ] **Step 1: Zero unresolved corners at both path fidelities**

```bash
npm run build -w blitsklieg
node spikes/alphabet-sweep.mjs --out sweep-after.md
node spikes/clamp-vs-blur.mjs
```

Expected: every letter's worst run at 100% in both looks, and — the check the spec asks for
explicitly — **zero unresolved corners on the direct-contour column too**, not only on the shipped
one. The rasterization blur currently masks the defect, so a model that only holds through the blur
will break the moment path fidelity lands.

- [ ] **Step 2: Run the unit suite**

```bash
npm run check
```

Expected: green.

- [ ] **Step 3: Run the visual suite and STOP**

```bash
npm run test:visual
```

**Do not pass `--update-snapshots`. Do not re-record.** Expected: exactly four failures —
`look-tubing`, `look-piping`, `offaxis-tubing`, `offaxis-piping`. Playwright writes actual and diff
images into `test-results/`, and those are the evidence for review.

**A fifth moved image means the change leaked into a look it cannot touch. Stop and report it rather
than reasoning around it.**

- [ ] **Step 4: Leave the re-record for the owner**

Two effects move these images and both should be named when presenting them, because the second is
easy to mistake for a regression:

1. `piping`'s cord roughly doubles in thickness — it was drawn at 26–69% of its requested 0.03 on
   every letter, and now draws at 0.03.
2. **Short runs' wander visibly flattens.** Task 5's cap binds at `tubing`'s shipped `amplitude: 0.02`
   for any run near its `minRun: 0.15`, so amplitude becomes a request rather than a guarantee there
   — the same language `runs` already carries.

The re-record recipe is in the spec's `## Baselines`. It is deliberately not run here.

- [ ] **Step 5: Record what the sweep measured after the change**

Replace the numbers in the spec's `## The tube is not one diameter` table with the post-change
figures, rather than adding a second table beside the first.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-19-tube-geometry-design.md
git commit -m "record the geometry model's acceptance numbers"
```

---

## Traps

- **Nothing after corner handling may reduce a run's bend radius below `ρmin`.** Task 5 is the only
  stage that did; if a later change adds another, it needs the same treatment.
- **A `transparent` material still writes depth by default**, which is how `tubing`'s 0.08 backing
  once culled its own tube. If a tube vanishes when thinned, eliminate render state before suspecting
  geometry.
- **Judge by looking at the image, not by a green test run.** The geometry has been correct while the
  render was visibly torn.
- **`--update-snapshots=all` is indiscriminate** — it re-encodes all fifteen baselines, burying the
  four that matter.
- **Do not `git add -A`.** Stage explicit paths.

## What this plan deliberately does not do

**Path fidelity.** The tube's path is not the font's curves: they are flattened, rasterized into a
256² signed distance field, re-extracted and smoothed three times. That rounding is why the letters
read as melted — but sharpening it makes the clamp *worse* (`N` goes from 31% to 16%), so the order
is forced. It cannot start until this lands and is tuned, and it carries its own risks: `piping`
traces at `level: -0.015`, so the field is doing real work there and cannot simply be bypassed.

**A per-look `bend` for `piping`.** Fabric cord bends tighter relative to its diameter than glass, so
`piping` is the candidate for a lower value — but that is a tuning call the lab answers once the
model is in, not a second default to guess now.

**The `bend` slider on the tube lab's parameter rail.** One row in `TUBE_FIELDS`: min 125, max 400,
scale 100, floored at 1.25. It belongs to whichever of the two branches lands second.
