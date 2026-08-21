import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rampAt } from '../../../src/render/tube/gradient.js';

describe('rampAt', () => {
  it('returns the only stop when there is one', () => {
    const c = rampAt([0xff2d95], 0.7);
    expect(c.getHex()).toBe(0xff2d95);
  });

  it('returns the endpoints at 0 and 1', () => {
    expect(rampAt([0xff0000, 0x0000ff], 0).getHex()).toBe(0xff0000);
    expect(rampAt([0xff0000, 0x0000ff], 1).getHex()).toBe(0x0000ff);
  });

  it('clamps outside 0..1 rather than extrapolating', () => {
    expect(rampAt([0xff0000, 0x0000ff], -3).getHex()).toBe(0xff0000);
    expect(rampAt([0xff0000, 0x0000ff], 9).getHex()).toBe(0x0000ff);
  });

  it('lands on an interior stop exactly', () => {
    const c = rampAt([0xff0000, 0x00ff00, 0x0000ff], 0.5);
    expect(c.getHex()).toBe(0x00ff00);
  });

  it('interpolates in linear space, not sRGB', () => {
    // The linear midpoint of black and white is mid-grey in LINEAR components, which is
    // 0.5 -> #bcbcbc once written back out as sRGB. An sRGB lerp would give #808080.
    const c = rampAt([0x000000, 0xffffff], 0.5);
    expect(c.r).toBeCloseTo(0.5, 6);
    expect(new THREE.Color().copy(c).getHexString()).toBe('bcbcbc');
  });

  it('falls back to white for an empty stop list, via THREE.Color leaving an undefined stop unset', () => {
    // Not a guarded case: stops[-2] is `undefined` out of bounds, and `new THREE.Color(undefined)`
    // quietly keeps three's own default (white) rather than throwing.
    expect(rampAt([], 0.7).getHex()).toBe(0xffffff);
  });
});

import { perRunT } from '../../../src/render/tube/gradient.js';

describe('perRunT', () => {
  it('spreads runIndex across the lit runs', () => {
    expect(
      perRunT({ of: 'runIndex' }, { litOrdinal: 0, litCount: 5, surface: 'front' }, ['front']),
    ).toBeCloseTo(0, 6);
    expect(
      perRunT({ of: 'runIndex' }, { litOrdinal: 4, litCount: 5, surface: 'front' }, ['front']),
    ).toBeCloseTo(1, 6);
    expect(
      perRunT({ of: 'runIndex' }, { litOrdinal: 2, litCount: 5, surface: 'front' }, ['front']),
    ).toBeCloseTo(0.5, 6);
  });

  it('gives a lone lit run 0 rather than dividing by zero', () => {
    expect(
      perRunT({ of: 'runIndex' }, { litOrdinal: 0, litCount: 1, surface: 'front' }, ['front']),
    ).toBe(0);
  });

  it('spreads surface across the layers the spec enables', () => {
    const layers = ['front', 'back', 'wall'] as const;
    expect(
      perRunT({ of: 'surface' }, { litOrdinal: 0, litCount: 9, surface: 'front' }, layers),
    ).toBeCloseTo(0, 6);
    expect(
      perRunT({ of: 'surface' }, { litOrdinal: 3, litCount: 9, surface: 'back' }, layers),
    ).toBeCloseTo(0.5, 6);
    expect(
      perRunT({ of: 'surface' }, { litOrdinal: 7, litCount: 9, surface: 'wall' }, layers),
    ).toBeCloseTo(1, 6);
  });

  it('gives 0 for a lone enabled surface even though it is listed', () => {
    expect(
      perRunT({ of: 'surface' }, { litOrdinal: 0, litCount: 4, surface: 'front' }, ['front']),
    ).toBe(0);
  });

  it('gives a surface the spec does not list 0', () => {
    expect(
      perRunT({ of: 'surface' }, { litOrdinal: 0, litCount: 4, surface: 'connector' }, ['front']),
    ).toBe(0);
  });

  it('is null for a domain that is not per run', () => {
    expect(
      perRunT({ of: 'run' }, { litOrdinal: 1, litCount: 4, surface: 'front' }, ['front']),
    ).toBeNull();
    expect(
      perRunT({ of: 'axis' }, { litOrdinal: 1, litCount: 4, surface: 'front' }, ['front']),
    ).toBeNull();
  });
});
