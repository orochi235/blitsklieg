import * as THREE from 'three';
import type { Point2 } from './field.js';
import { rotationMinimizingFrames } from './frames.js';
import { minCurvatureRadius3, smooth } from './resample.js';
import type { Run } from './runs.js';

/** How much of the local curvature radius a tube may occupy before it self-intersects. */
const CLEARANCE = 0.8;
/** Smoothing happens here rather than upstream: a run ends at a corner, so it never crosses one. */
const SMOOTH_PASSES = 3;

/**
 * A run's centerline smoothed in x/y, z untouched. Used for both the curvature measurement and
 * the swept path itself, so the tube doesn't trace the staircase noise this smoothing exists to
 * see past.
 */
function smoothedPoints(run: Run): THREE.Vector3[] {
  const flat = smooth(
    run.points.map((p) => ({ x: p.x, y: p.y })),
    SMOOTH_PASSES,
    'open',
  );
  return run.points.map((p, i) => {
    const f = flat[i] as Point2;
    return new THREE.Vector3(f.x, f.y, p.z);
  });
}

/**
 * A sweep whose radius exceeds the path's local radius of curvature turns inside out. Measured
 * on the lab font this is common rather than exotic, and the run floor does not catch it — a run
 * can be long and still contain one tight corner.
 */
export function sweepRadius(run: Run, requested: number): number {
  const points = smoothedPoints(run);
  const tightest = minCurvatureRadius3(points);
  if (!Number.isFinite(tightest)) return requested;
  return Math.min(requested, tightest * CLEARANCE);
}

/**
 * Builds tube geometry directly from a rotation-minimizing frame at each point, rather than
 * THREE.TubeGeometry's Frenet frames — Frenet is undefined at inflection points and flips sign
 * wherever curvature is small, tearing the swept surface on any run that bends in 3D.
 */
function buildTubeGeometry(
  points: THREE.Vector3[],
  radius: number,
  segments: number,
): THREE.BufferGeometry {
  const frames = rotationMinimizingFrames(points);
  const ringCount = points.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < ringCount; i++) {
    const frame = frames[i] as (typeof frames)[number];
    const p = points[i] as THREE.Vector3;
    for (let j = 0; j <= segments; j++) {
      const v = (j / segments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      const nx = cos * frame.normal.x + sin * frame.binormal.x;
      const ny = cos * frame.normal.y + sin * frame.binormal.y;
      const nz = cos * frame.normal.z + sin * frame.binormal.z;
      normals.push(nx, ny, nz);
      positions.push(p.x + radius * nx, p.y + radius * ny, p.z + radius * nz);
      uvs.push(i / (ringCount - 1), j / segments);
    }
  }

  for (let j = 1; j < ringCount; j++) {
    for (let i = 1; i <= segments; i++) {
      const a = (segments + 1) * (j - 1) + (i - 1);
      const b = (segments + 1) * j + (i - 1);
      const c = (segments + 1) * j + i;
      const d = (segments + 1) * (j - 1) + i;
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeBoundingSphere();
  return geo;
}

export function sweepRun(
  run: Run,
  requested: number,
  segments: number,
): THREE.BufferGeometry | null {
  if (run.points.length < 2) return null;
  const radius = sweepRadius(run, requested);
  if (radius <= 0) return null;
  // Points are already arc-length spaced (resample.ts) and corner-cut (runs.ts), so a
  // Catmull-Rom re-resample bought nothing but a second parameterization to reason about.
  const points = smoothedPoints(run);
  return buildTubeGeometry(points, radius, segments);
}
