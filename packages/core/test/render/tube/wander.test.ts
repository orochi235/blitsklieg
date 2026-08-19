import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Run } from '../../../src/render/tube/runs.js';
import { wanderFaceRuns } from '../../../src/render/tube/wander.js';

function straightRun(surface: Run['surface'], n = 9): Run {
  const points = Array.from({ length: n }, (_, i) => new THREE.Vector3(i, 0, 0.5));
  return { points, surface, length: n - 1, index: 0, lit: true, color: 0 };
}

describe('wanderFaceRuns', () => {
  it('leaves points untouched at amplitude 0', () => {
    const run = straightRun('front');
    const z = run.points.map((p) => p.z);

    wanderFaceRuns([run], 0, 1);

    expect(run.points.map((p) => p.z)).toEqual(z);
  });

  it('pins both ends to their original z', () => {
    const run = straightRun('front');
    const startZ = run.points[0]?.z;
    const endZ = run.points[run.points.length - 1]?.z;

    wanderFaceRuns([run], 0.05, 1);

    expect(run.points[0]?.z).toBeCloseTo(startZ as number, 10);
    expect(run.points[run.points.length - 1]?.z).toBeCloseTo(endZ as number, 10);
  });

  it('displaces interior points, and never touches x/y', () => {
    const run = straightRun('front');
    const xy = run.points.map((p) => [p.x, p.y]);

    wanderFaceRuns([run], 0.05, 1);

    expect(run.points.some((p) => Math.abs(p.z - 0.5) > 1e-9)).toBe(true);
    expect(run.points.map((p) => [p.x, p.y])).toEqual(xy);
  });

  it('never touches a wall or connector run', () => {
    const wall = straightRun('wall');
    const connector = straightRun('connector');
    const wallZ = wall.points.map((p) => p.z);
    const connectorZ = connector.points.map((p) => p.z);

    wanderFaceRuns([wall, connector], 0.05, 1);

    expect(wall.points.map((p) => p.z)).toEqual(wallZ);
    expect(connector.points.map((p) => p.z)).toEqual(connectorZ);
  });

  it('is deterministic for the same seed and run index, and varies with either', () => {
    const a = straightRun('front');
    const b = straightRun('front');
    wanderFaceRuns([a], 0.05, 7);
    wanderFaceRuns([b], 0.05, 7);
    expect(a.points.map((p) => p.z)).toEqual(b.points.map((p) => p.z));

    const differentSeed = straightRun('front');
    wanderFaceRuns([differentSeed], 0.05, 9);
    expect(differentSeed.points.map((p) => p.z)).not.toEqual(a.points.map((p) => p.z));

    const differentIndex = { ...straightRun('front'), index: 1 };
    wanderFaceRuns([differentIndex], 0.05, 7);
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

    wanderFaceRuns([run], 0.05, 1);

    expect(run.points.map((p) => p.z)).toEqual(z);
  });
});
