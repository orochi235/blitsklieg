import { describe, expect, it } from 'vitest';
import { envRotationAt, LIGHTING, type LightingName } from '../../src/render/lighting.js';

const NAMES: LightingName[] = ['sweep', 'static'];
const TAU = Math.PI * 2;

describe('LIGHTING', () => {
  it('has an entry for every name in the union', () => {
    expect(Object.keys(LIGHTING).sort()).toEqual([...NAMES].sort());
  });
});

describe('envRotationAt', () => {
  it('turns sweep a full rotation over its own period, not the active slot duration', () => {
    expect(envRotationAt('sweep', 0)).toBeCloseTo(0);
    expect(envRotationAt('sweep', LIGHTING.sweep.periodMs)).toBeCloseTo(TAU);
    expect(envRotationAt('sweep', LIGHTING.sweep.periodMs / 2)).toBeCloseTo(TAU / 2);
  });

  it('holds static still at every elapsed time', () => {
    expect(envRotationAt('static', 0)).toBe(0);
    expect(envRotationAt('static', 9999)).toBe(0);
  });

  it('keeps turning past one period rather than clamping', () => {
    expect(envRotationAt('sweep', LIGHTING.sweep.periodMs * 1.5)).toBeCloseTo(TAU * 1.5);
  });
});
