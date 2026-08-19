import { describe, expect, it } from 'vitest';
import { minCurvatureRadius, resample, smooth } from '../../../src/render/tube/resample.js';

/** A circle of radius r, sampled unevenly so resampling has something to correct. */
function circle(r: number, n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) ** 1.6 * Math.PI * 2;
    return { x: Math.cos(t) * r, y: Math.sin(t) * r };
  });
}

/** A closed square of side `s`, centred on the origin, with `perSide` points along each edge. */
function square(s: number, perSide: number): { x: number; y: number }[] {
  const h = s / 2;
  const corners = [
    { x: -h, y: -h },
    { x: h, y: -h },
    { x: h, y: h },
    { x: -h, y: h },
  ];
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i] as { x: number; y: number };
    const b = corners[(i + 1) % 4] as { x: number; y: number };
    for (let j = 0; j < perSide; j++) {
      const t = j / perSide;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return pts;
}

/** Largest turn angle, in degrees, between consecutive edges of a closed polyline. */
function maxTurnAngleDeg(line: { x: number; y: number }[]): number {
  const n = line.length;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const a = line[(i - 1 + n) % n] as { x: number; y: number };
    const b = line[i] as { x: number; y: number };
    const c = line[(i + 1) % n] as { x: number; y: number };
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const angle = Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y);
    max = Math.max(max, Math.abs((angle * 180) / Math.PI));
  }
  return max;
}

describe('resample', () => {
  it('spaces points by arc length, not by input point count', () => {
    const sparse = resample(circle(1, 12), 0.1);
    const dense = resample(circle(1, 400), 0.1);
    // Same curve, wildly different input resolution: output counts must agree.
    expect(Math.abs(sparse.length - dense.length)).toBeLessThanOrEqual(1);
  });

  it('scales point count with path length', () => {
    const small = resample(circle(1, 100), 0.1);
    const big = resample(circle(2, 100), 0.1);
    expect(big.length).toBeGreaterThan(small.length * 1.8);
  });

  // Guards against reintroducing corner-cutting (e.g. Chaikin subdivision) into resample():
  // a later pipeline stage detects corners on this exact output to decide where tube runs
  // split, and rounded corners make that detection silently miss every one of them.
  it('preserves sharp corners instead of rounding them', () => {
    const out = resample(square(1, 15), 0.02);
    const angle = maxTurnAngleDeg(out);
    expect(angle).toBeGreaterThan(80);
  });
});

describe('minCurvatureRadius', () => {
  it('recovers the radius of a circle', () => {
    // Curvature is only meaningful on a smoothed path in this pipeline: resample() alone
    // preserves the input's straight edges (see the corner-preservation test above), so it
    // reports the input's own elbow artifacts as curvature, not the underlying circle's.
    const r = minCurvatureRadius(smooth(resample(circle(0.5, 200), 0.01), 3, 'closed'));
    expect(r).toBeGreaterThan(0.45);
    expect(r).toBeLessThan(0.55);
  });

  it('reports a larger radius after smoothing removes staircase noise', () => {
    const noisy = circle(1, 200).map((p, i) => ({
      x: p.x + (i % 2 ? 0.004 : -0.004),
      y: p.y + (i % 3 ? 0.004 : -0.004),
    }));
    const before = minCurvatureRadius(noisy);
    const after = minCurvatureRadius(smooth(noisy, 3, 'closed'));
    expect(after).toBeGreaterThan(before * 2);
  });
});
