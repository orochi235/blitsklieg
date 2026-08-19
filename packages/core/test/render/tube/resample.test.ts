import { describe, expect, it } from 'vitest';
import { minCurvatureRadius, resample, smooth } from '../../../src/render/tube/resample.js';

/** A circle of radius r, sampled unevenly so resampling has something to correct. */
function circle(r: number, n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) ** 1.6 * Math.PI * 2;
    return { x: Math.cos(t) * r, y: Math.sin(t) * r };
  });
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
});

describe('minCurvatureRadius', () => {
  it('recovers the radius of a circle', () => {
    const r = minCurvatureRadius(resample(circle(0.5, 200), 0.01));
    expect(r).toBeGreaterThan(0.45);
    expect(r).toBeLessThan(0.55);
  });

  it('reports a larger radius after smoothing removes staircase noise', () => {
    const noisy = circle(1, 200).map((p, i) => ({
      x: p.x + (i % 2 ? 0.004 : -0.004),
      y: p.y + (i % 3 ? 0.004 : -0.004),
    }));
    const before = minCurvatureRadius(noisy);
    const after = minCurvatureRadius(smooth(noisy, 3));
    expect(after).toBeGreaterThan(before * 2);
  });
});
