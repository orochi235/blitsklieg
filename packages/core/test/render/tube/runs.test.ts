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

  it('treats a corner split across two vertices as one corner', () => {
    // A resampled 90 degree corner lands between vertices, so both neighbours break the
    // threshold. Counting them separately cuts a sliver out of the corner.
    const pts = squarePath();
    const rounded = pts.map((p, i) => (i === 10 ? new THREE.Vector3(0.47, -0.47, 0) : p));
    const runs = cutIntoRuns([PATH(rounded)], { runs: 1, minRun: 0 });
    expect(runs).toHaveLength(4);
  });

  it('drops runs under the floor and keeps the rest', () => {
    const loose = cutIntoRuns([PATH(squarePath())], { runs: 20, minRun: 0 });
    const floored = cutIntoRuns([PATH(squarePath())], { runs: 20, minRun: 0.15 });
    // Some must survive: a floor that drops everything satisfies the per-run assertion vacuously.
    expect(floored.length).toBeGreaterThan(0);
    expect(floored.length).toBeLessThan(loose.length);
    for (const run of floored) expect(run.length).toBeGreaterThanOrEqual(0.15);
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
