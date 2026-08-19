import type * as THREE from 'three';
import type { Run } from './runs.js';

/** Same generator assign.ts and decoration.ts use, so seeding behaves consistently pipeline-wide. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cumulative arc length at each point, `cum[0] === 0`. */
function cumulativeLengths(points: THREE.Vector3[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] as THREE.Vector3;
    cum.push((cum[i - 1] as number) + (points[i] as THREE.Vector3).distanceTo(prev));
  }
  return cum;
}

/**
 * Bends a face run's z gently along its length — x/y keep hugging the level set. `sin(s * PI *
 * lobes)` is zero at s=0 and s=1 for any integer `lobes`, which pins both ends to their original
 * z for free: a run boundary stays put, so an adjacent run still meets it without a seam.
 */
export function wanderFaceRuns(runs: Run[], amplitude: number, seed: number): void {
  if (amplitude === 0) return;

  for (const run of runs) {
    if (run.surface !== 'front' && run.surface !== 'back') continue;
    const points = run.points;
    if (points.length < 3) continue;

    const cum = cumulativeLengths(points);
    const total = cum[cum.length - 1] as number;
    if (total <= 0) continue;

    const random = rng((Math.round(seed * 2654435761) ^ 0x9e3779b1 ^ run.index) >>> 0);
    // One or two slow undulations, never per-point noise — the run is swept with a Catmull-Rom
    // curve, and it has to read as gently bent tube.
    const lobes = 1 + (random() < 0.5 ? 0 : 1);
    const sign = random() < 0.5 ? -1 : 1;
    const scale = 0.7 + random() * 0.3;

    for (let i = 0; i < points.length; i++) {
      const s = (cum[i] as number) / total;
      (points[i] as THREE.Vector3).z += amplitude * sign * scale * Math.sin(s * Math.PI * lobes);
    }
  }
}
