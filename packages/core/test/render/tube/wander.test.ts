import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { minCurvatureRadius3 } from '../../../src/render/tube/resample.js';
import type { Run } from '../../../src/render/tube/runs.js';
import { wanderFaceRuns } from '../../../src/render/tube/wander.js';

/** The shipped tubing rho_min. These runs are 8 units long, so the cap never binds on them. */
const RHO_MIN = 0.044;

function straightRun(surface: Run['surface'], n = 9): Run {
  const points = Array.from({ length: n }, (_, i) => new THREE.Vector3(i, 0, 0.5));
  return { points, surface, length: n - 1, index: 0, lit: true, color: 0 };
}

/** A front run of `length` em sampled at the pipeline's own spacing. */
function shortRun(length: number, index: number): Run {
  const n = Math.max(3, Math.round(length / 0.02) + 1);
  const points = Array.from(
    { length: n },
    (_, i) => new THREE.Vector3((i / (n - 1)) * length, 0, 0),
  );
  return { points, surface: 'front', length, index, lit: true, color: 0 };
}

const bendOf = (run: Run) =>
  minCurvatureRadius3(run.points.map((p) => ({ x: p.x, y: p.y, z: p.z })));

describe('wanderFaceRuns', () => {
  it('leaves points untouched at amplitude 0', () => {
    const run = straightRun('front');
    const z = run.points.map((p) => p.z);

    wanderFaceRuns([run], 0, 1, RHO_MIN);

    expect(run.points.map((p) => p.z)).toEqual(z);
  });

  it('pins both ends to their original z', () => {
    const run = straightRun('front');
    const startZ = run.points[0]?.z;
    const endZ = run.points[run.points.length - 1]?.z;

    wanderFaceRuns([run], 0.05, 1, RHO_MIN);

    expect(run.points[0]?.z).toBeCloseTo(startZ as number, 10);
    expect(run.points[run.points.length - 1]?.z).toBeCloseTo(endZ as number, 10);
  });

  it('displaces interior points, and never touches x/y', () => {
    const run = straightRun('front');
    const xy = run.points.map((p) => [p.x, p.y]);

    wanderFaceRuns([run], 0.05, 1, RHO_MIN);

    expect(run.points.some((p) => Math.abs(p.z - 0.5) > 1e-9)).toBe(true);
    expect(run.points.map((p) => [p.x, p.y])).toEqual(xy);
  });

  it('never touches a wall or connector run', () => {
    const wall = straightRun('wall');
    const connector = straightRun('connector');
    const wallZ = wall.points.map((p) => p.z);
    const connectorZ = connector.points.map((p) => p.z);

    wanderFaceRuns([wall, connector], 0.05, 1, RHO_MIN);

    expect(wall.points.map((p) => p.z)).toEqual(wallZ);
    expect(connector.points.map((p) => p.z)).toEqual(connectorZ);
  });

  it('is deterministic for the same seed and run index, and varies with either', () => {
    const a = straightRun('front');
    const b = straightRun('front');
    wanderFaceRuns([a], 0.05, 7, RHO_MIN);
    wanderFaceRuns([b], 0.05, 7, RHO_MIN);
    expect(a.points.map((p) => p.z)).toEqual(b.points.map((p) => p.z));

    const differentSeed = straightRun('front');
    wanderFaceRuns([differentSeed], 0.05, 9, RHO_MIN);
    expect(differentSeed.points.map((p) => p.z)).not.toEqual(a.points.map((p) => p.z));

    const differentIndex = { ...straightRun('front'), index: 1 };
    wanderFaceRuns([differentIndex], 0.05, 7, RHO_MIN);
    expect(differentIndex.points.map((p) => p.z)).not.toEqual(a.points.map((p) => p.z));
  });

  it('skips a run too short to carry a wander', () => {
    const run: Run = {
      points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)],
      surface: 'front',
      length: 1,
      index: 0,
      lit: true,
      color: 0,
    };
    const z = run.points.map((p) => p.z);

    wanderFaceRuns([run], 0.05, 1, RHO_MIN);

    expect(run.points.map((p) => p.z)).toEqual(z);
  });

  /**
   * A sinusoid's tightest bend is `T^2 / (A * scale * pi^2 * lobes^2)`, at the crest where the slope
   * term vanishes. Two lobes at the shipped amplitude of 0.02 over tubing's own minRun of 0.15 bend
   * at 0.033 against a rho_min of 0.044 — so the shipped spec breaches its own invariant on the
   * shortest run its floor permits. Every seed, since lobes and sign are drawn per run.
   */
  it('keeps a short run above rhoMin at the shipped amplitude', () => {
    for (let index = 0; index < 12; index++) {
      const run = shortRun(0.15, index);
      wanderFaceRuns([run], 0.02, 0, RHO_MIN);
      expect(bendOf(run), `seed index ${index}`).toBeGreaterThan(RHO_MIN);
    }
  });

  it("leaves a long run's wander untouched, since it never breaches", () => {
    const uncapped = shortRun(0.6, 3);
    const capped = shortRun(0.6, 3);
    wanderFaceRuns([uncapped], 0.02, 0, 0);
    wanderFaceRuns([capped], 0.02, 0, RHO_MIN);
    for (let i = 0; i < uncapped.points.length; i++) {
      expect((capped.points[i] as THREE.Vector3).z).toBeCloseTo(
        (uncapped.points[i] as THREE.Vector3).z,
        9,
      );
    }
  });
});
