import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Run } from '../../../src/render/tube/runs.js';
import { sweepRadius, sweepRun } from '../../../src/render/tube/sweep.js';

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

/** An arc of the given radius swept in the x/z plane instead of x/y: straight when flattened to x/y. */
function depthArcRun(radius: number, sweep: number): Run {
  const points = Array.from({ length: 40 }, (_, i) => {
    const t = (i / 39) * sweep;
    return new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius);
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

  it('tapers for curvature that lives entirely in depth', () => {
    // Flattened to x/y this run is collinear (y is always 0) and would read as straight; the
    // curve only bends in z. A 2D-only curvature measurement misses this entirely.
    const r = sweepRadius(depthArcRun(0.02, Math.PI / 2), 0.05);
    expect(r).toBeLessThan(0.02);
    expect(r).toBeGreaterThan(0);
  });
});

describe('sweepRun', () => {
  it('builds geometry with position and normal attributes', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.05, 8);
    expect(geo?.getAttribute('position').count).toBeGreaterThan(0);
    expect(geo?.getAttribute('normal').count).toBeGreaterThan(0);
    geo?.dispose();
  });

  it('returns null for a run too short to sweep', () => {
    const run = arcRun(1, Math.PI / 2);
    run.points = run.points.slice(0, 1);
    expect(sweepRun(run, 0.05, 8)).toBeNull();
  });

  it('bakes uv.x as normalized arc length along the run, 0 at the start and 1 at the end', () => {
    const geo = sweepRun(arcRun(1, Math.PI / 2), 0.05, 6);
    const uv = geo?.getAttribute('uv') as THREE.BufferAttribute;
    const ringCount = (geo?.getAttribute('position').count ?? 0) / 7; // segments 6 -> 7 verts/ring
    let prev = -1;
    for (let ring = 0; ring < ringCount; ring++) {
      const t = uv.getX(ring * 7);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(uv.getX(0)).toBeCloseTo(0, 10);
    expect(uv.getX((ringCount - 1) * 7)).toBeCloseTo(1, 10);
    geo?.dispose();
  });

  it('produces finite, non-degenerate geometry for a run that bends through 3D', () => {
    // An S-shaped run: bends one way then the other, and wanders in z, the exact shape that
    // tore under Frenet frames.
    const points = Array.from({ length: 60 }, (_, i) => {
      const t = i / 59;
      return new THREE.Vector3(
        t * 2 - 1,
        Math.sin(t * Math.PI * 2) * 0.5,
        Math.sin(t * Math.PI) * 0.1,
      );
    });
    const run: Run = { points, surface: 'front', length: 4, index: 0, lit: true, color: 0xffffff };
    const geo = sweepRun(run, 0.02, 10);
    const position = geo?.getAttribute('position');
    expect(position).toBeDefined();
    const array = (position as THREE.BufferAttribute).array;
    for (let i = 0; i < array.length; i++) {
      expect(Number.isFinite(array[i])).toBe(true);
    }
    geo?.dispose();
  });
});
