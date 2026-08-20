import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GeneratedPath } from '../../../src/render/tube/generators.js';
import { wanderPaths } from '../../../src/render/tube/wander.js';

function straightPath(surface: GeneratedPath['surface'], n = 9): GeneratedPath {
  return {
    points: Array.from({ length: n }, (_, i) => new THREE.Vector3(i, 0, 0.5)),
    surface,
    closed: false,
  };
}

/** A closed square, whose first and last points are a step apart across the seam. */
function closedPath(): GeneratedPath {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(t), Math.sin(t), 0.5));
  }
  return { points: pts, surface: 'front', closed: true };
}

describe('wanderPaths', () => {
  it('leaves points untouched at amplitude 0', () => {
    const path = straightPath('front');
    const z = path.points.map((p) => p.z);

    wanderPaths([path], 0, 1);

    expect(path.points.map((p) => p.z)).toEqual(z);
  });

  it('pins both ends of an open path to their original z', () => {
    const path = straightPath('front');

    wanderPaths([path], 0.05, 1);

    expect(path.points[0]?.z).toBeCloseTo(0.5, 10);
    expect(path.points[path.points.length - 1]?.z).toBeCloseTo(0.5, 10);
  });

  it('meets itself across a closed path’s seam', () => {
    const path = closedPath();

    wanderPaths([path], 0.05, 1);

    // A whole number of periods, so the step across the seam is the step everywhere else. Anything
    // else leaves the contour with a z discontinuity the sweep would draw as a kink.
    const first = path.points[0] as THREE.Vector3;
    const last = path.points[path.points.length - 1] as THREE.Vector3;
    const second = path.points[1] as THREE.Vector3;
    expect(Math.abs(last.z - first.z)).toBeLessThan(Math.abs(second.z - first.z) * 2 + 1e-9);
  });

  it('displaces interior points, and never touches x/y', () => {
    const path = straightPath('front');
    const xy = path.points.map((p) => [p.x, p.y]);

    wanderPaths([path], 0.05, 1);

    expect(path.points.some((p) => Math.abs(p.z - 0.5) > 1e-9)).toBe(true);
    expect(path.points.map((p) => [p.x, p.y])).toEqual(xy);
  });

  it('never touches a wall or connector path', () => {
    const wall = straightPath('wall');
    const connector = straightPath('connector');
    const wallZ = wall.points.map((p) => p.z);
    const connectorZ = connector.points.map((p) => p.z);

    wanderPaths([wall, connector], 0.05, 1);

    expect(wall.points.map((p) => p.z)).toEqual(wallZ);
    expect(connector.points.map((p) => p.z)).toEqual(connectorZ);
  });

  it('is deterministic for the same seed and position, and varies with either', () => {
    const a = straightPath('front');
    const b = straightPath('front');
    wanderPaths([a], 0.05, 7);
    wanderPaths([b], 0.05, 7);
    expect(a.points.map((p) => p.z)).toEqual(b.points.map((p) => p.z));

    const differentSeed = straightPath('front');
    wanderPaths([differentSeed], 0.05, 9);
    expect(differentSeed.points.map((p) => p.z)).not.toEqual(a.points.map((p) => p.z));

    const second = straightPath('front');
    wanderPaths([straightPath('front'), second], 0.05, 7);
    expect(second.points.map((p) => p.z)).not.toEqual(a.points.map((p) => p.z));
  });

  it('skips a path too short to carry a wander', () => {
    const path: GeneratedPath = {
      points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)],
      surface: 'front',
      closed: false,
    };
    const z = path.points.map((p) => p.z);

    wanderPaths([path], 0.05, 1);

    expect(path.points.map((p) => p.z)).toEqual(z);
  });
});
