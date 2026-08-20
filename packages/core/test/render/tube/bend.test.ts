import { describe, expect, it } from 'vitest';
import { BEND_FLOOR, DEFAULT_BEND, minBendRadius } from '../../../src/render/tube/bend.js';

describe('minBendRadius', () => {
  it('is bend times the tube radius', () => {
    expect(minBendRadius(0.022, 2)).toBeCloseTo(0.044, 6);
  });

  it('defaults to DEFAULT_BEND when the spec sets none', () => {
    expect(minBendRadius(0.022, undefined)).toBeCloseTo(0.022 * DEFAULT_BEND, 6);
  });

  // The mesh turns inside out below 1/CLEARANCE, whatever the look claims about its material.
  it('floors a bend below the point the sweep self-intersects', () => {
    expect(minBendRadius(0.022, 0.5)).toBeCloseTo(0.022 * BEND_FLOOR, 6);
    expect(BEND_FLOOR).toBeCloseTo(1.25, 6);
  });
});
