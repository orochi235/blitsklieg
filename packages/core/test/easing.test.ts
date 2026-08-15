import { describe, expect, it } from 'vitest';
import {
  backOut,
  clamp01,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  linear,
} from '../src/easing.js';

const CURVES = { linear, easeOutCubic, easeInCubic, easeInOutCubic, backOut };
const MONOTONIC_CURVES = { linear, easeOutCubic, easeInCubic, easeInOutCubic };

const SAMPLE_TS = Array.from({ length: 999 }, (_, i) => (i + 1) / 1000);

describe('easing', () => {
  it('every curve is pinned at both endpoints', () => {
    for (const [name, fn] of Object.entries(CURVES)) {
      expect(fn(0), `${name}(0)`).toBeCloseTo(0, 6);
      expect(fn(1), `${name}(1)`).toBeCloseTo(1, 6);
    }
  });

  it('linear is the identity function', () => {
    expect(linear(0.37)).toBe(0.37);
  });

  it('easeOutCubic and easeInCubic match known values at t=0.5', () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 12);
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 12);
  });

  it('easeInOutCubic matches known values off the seam in each branch', () => {
    expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625, 12);
    expect(easeInOutCubic(0.75)).toBeCloseTo(0.9375, 12);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
  });

  it('backOut overshoots to ~1.10 at t≈0.58, then settles, never dipping below 0', () => {
    expect(backOut(0.5801025)).toBeCloseTo(1.1000041, 6);
    expect(Math.max(...SAMPLE_TS.map(backOut))).toBeLessThan(1.11);
    expect(Math.min(...SAMPLE_TS.map(backOut))).toBeGreaterThanOrEqual(0);
  });

  it('every curve except backOut is monotonically non-decreasing', () => {
    for (const [name, fn] of Object.entries(MONOTONIC_CURVES)) {
      let prev = fn(0);
      for (const t of SAMPLE_TS) {
        const value = fn(t);
        expect(value, `${name} decreased at t=${t}`).toBeGreaterThanOrEqual(prev);
        prev = value;
      }
    }
  });

  it('backOut is not monotonically non-decreasing (overshoot is intentional)', () => {
    let sawDecrease = false;
    let prev = backOut(0);
    for (const t of SAMPLE_TS) {
      const value = backOut(t);
      if (value < prev) {
        sawDecrease = true;
      }
      prev = value;
    }
    expect(sawDecrease).toBe(true);
  });

  it('clamp01 clamps values below 0 and above 1, passes in-range values through, and maps NaN to 0', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(-0.0001)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(1.0001)).toBe(1);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});
