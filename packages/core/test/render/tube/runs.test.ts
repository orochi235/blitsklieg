import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ALL_BREAK, ALL_CONNECT, cutIntoRuns } from '../../../src/render/tube/runs.js';

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
      pts.push(
        new THREE.Vector3(
          (ax as number) + ((bx as number) - (ax as number)) * t,
          (ay as number) + ((by as number) - (ay as number)) * t,
          0,
        ),
      );
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

/** An open L-shaped polyline: one interior 90 degree corner, straight legs on either side. */
function openLPath(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) pts.push(new THREE.Vector3(i / 10, 0, 0));
  for (let i = 1; i <= 10; i++) pts.push(new THREE.Vector3(1, i / 10, 0));
  return pts;
}

const PATH = (points: THREE.Vector3[]) => ({ points, surface: 'front' as const, closed: true });
const OPEN_PATH = (points: THREE.Vector3[]) => ({
  points,
  surface: 'front' as const,
  closed: false,
});

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

  it('hits the requested count exactly at high piece counts, not just low ones', () => {
    // A single-span cornerless loop with no floor: nothing but slice()'s own arithmetic can
    // cost a run here. Low counts (a handful of cuts) can't show compounding drift; these can.
    for (const requested of [13, 30, 60]) {
      const runs = cutIntoRuns([PATH(circlePath())], { runs: requested, minRun: 0 });
      expect(runs.length, `requested ${requested}, got ${runs.length}`).toBe(requested);
    }
  });

  it('never returns fewer runs than there are corners', () => {
    const runs = cutIntoRuns([PATH(squarePath())], { runs: 2, minRun: 0 });
    expect(runs).toHaveLength(4);
  });

  it('reaches the requested count when it exceeds the corner count', () => {
    const runs = cutIntoRuns([PATH(squarePath())], { runs: 8, minRun: 0 });
    expect(runs).toHaveLength(8);
  });

  it('treats a corner split across two vertices as one corner', () => {
    // A resampled 90 degree corner lands between vertices, so both neighbours break the
    // threshold. Counting them separately cuts a sliver out of the corner.
    const pts = squarePath();
    const rounded = pts.map((p, i) => (i === 10 ? new THREE.Vector3(0.47, -0.47, 0) : p));
    const runs = cutIntoRuns([PATH(rounded)], { runs: 1, minRun: 0 });
    expect(runs).toHaveLength(4);
  });

  it('drops runs under the floor and keeps the rest', () => {
    // 18 requested over 4 equal-length sides splits unevenly by largest-remainder: two sides
    // get 5 pieces (length 0.2), two get 4 (length 0.25). A 0.22 floor keeps only the latter.
    const loose = cutIntoRuns([PATH(squarePath())], { runs: 18, minRun: 0 });
    const floored = cutIntoRuns([PATH(squarePath())], { runs: 18, minRun: 0.22 });
    // Some must survive: a floor that drops everything satisfies the per-run assertion vacuously.
    expect(floored.length).toBeGreaterThan(0);
    expect(floored.length).toBeLessThan(loose.length);
    for (const run of floored) expect(run.length).toBeGreaterThanOrEqual(0.22);
  });

  it('carries surface, length and index on every run', () => {
    const runs = cutIntoRuns([PATH(squarePath())], { runs: 4, minRun: 0 });
    runs.forEach((run, i) => {
      expect(run.surface).toBe('front');
      expect(run.index).toBe(i);
      expect(run.length).toBeGreaterThan(0);
    });
  });

  it('cuts an open path at an interior corner without treating its endpoints as corners', () => {
    const runs = cutIntoRuns([OPEN_PATH(openLPath())], { runs: 2, minRun: 0 });
    expect(runs).toHaveLength(2);
  });
});

describe('corner strategies', () => {
  it('an all-break distribution reproduces the plain corner-cut run count', () => {
    const runs = cutIntoRuns([PATH(squarePath())], { runs: 1, minRun: 0, corners: ALL_BREAK });
    expect(runs).toHaveLength(4);
  });

  it('an all-connect distribution on a closed contour yields one run', () => {
    const runs = cutIntoRuns([PATH(squarePath())], { runs: 1, minRun: 0, corners: ALL_CONNECT });
    expect(runs).toHaveLength(1);
  });

  it('an all-connect distribution keeps an open path in one piece too', () => {
    const runs = cutIntoRuns([OPEN_PATH(openLPath())], {
      runs: 1,
      minRun: 0,
      corners: ALL_CONNECT,
    });
    expect(runs).toHaveLength(1);
  });

  it('a loop inserts geometry and leaves the run continuous', () => {
    const broken = cutIntoRuns([PATH(squarePath())], { runs: 1, minRun: 0, corners: ALL_BREAK });
    const looped = cutIntoRuns([PATH(squarePath())], {
      runs: 1,
      minRun: 0,
      corners: { break: 0, connect: 0, loop: 1 },
      radius: 0.02,
    });
    // Still one continuous run around the square, not four.
    expect(looped).toHaveLength(1);
    // But a lot longer than the plain square outline: four loops were spliced in.
    const brokenTotal = broken.reduce((a, r) => a + r.length, 0);
    expect((looped[0] as { length: number }).length).toBeGreaterThan(brokenTotal * 1.3);
  });

  it('is deterministic for a seed and differs across seeds', () => {
    const weights = { break: 1, connect: 1, loop: 1 };
    const a = cutIntoRuns([PATH(squarePath())], { runs: 1, minRun: 0, corners: weights, seed: 3 });
    const b = cutIntoRuns([PATH(squarePath())], { runs: 1, minRun: 0, corners: weights, seed: 3 });
    expect(a.map((r) => r.length)).toEqual(b.map((r) => r.length));

    const lengths = new Set<number>();
    for (let seed = 0; seed < 8; seed++) {
      const runs = cutIntoRuns([PATH(squarePath())], {
        runs: 1,
        minRun: 0,
        corners: weights,
        seed,
      });
      lengths.add(runs.length);
    }
    expect(lengths.size).toBeGreaterThan(1);
  });
});
