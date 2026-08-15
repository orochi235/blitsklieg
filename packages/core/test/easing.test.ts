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

const SAMPLE_TS = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);

describe('easing', () => {
  it('every curve is pinned at both endpoints', () => {
    for (const [name, fn] of Object.entries(CURVES)) {
      expect(fn(0), `${name}(0)`).toBeCloseTo(0, 6);
      expect(fn(1), `${name}(1)`).toBeCloseTo(1, 6);
    }
  });

  it('backOut overshoots past 1 before settling', () => {
    const peak = Math.max(...SAMPLE_TS.map((t) => backOut(t)));
    expect(peak).toBeGreaterThan(1);
  });

  it('easeOutCubic is past halfway at t=0.5', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('easeInCubic is short of halfway at t=0.5', () => {
    expect(easeInCubic(0.5)).toBeLessThan(0.5);
  });

  it('easeInOutCubic passes through 0.5 at t=0.5', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
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

  it('clamp01 clamps values below 0 and above 1, and passes in-range values through', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(-0.0001)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(1.0001)).toBe(1);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
  });
});
