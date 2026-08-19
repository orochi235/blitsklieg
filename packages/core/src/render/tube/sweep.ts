import * as THREE from 'three';
import type { Point2 } from './field.js';
import { minCurvatureRadius, smooth } from './resample.js';
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
  const tightest = minCurvatureRadius(points.map((p) => ({ x: p.x, y: p.y })));
  if (!Number.isFinite(tightest)) return requested;
  return Math.min(requested, tightest * CLEARANCE);
}

export function sweepRun(
  run: Run,
  requested: number,
  segments: number,
): THREE.BufferGeometry | null {
  if (run.points.length < 2) return null;
  const radius = sweepRadius(run, requested);
  if (radius <= 0) return null;
  const points = smoothedPoints(run);
  // Catmull-Rom rather than a polyline: neon tube cannot bend square, and the run's own points
  // are already arc-length spaced, so centripetal parameterisation will not overshoot.
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.TubeGeometry(curve, points.length, radius, segments, false);
}
