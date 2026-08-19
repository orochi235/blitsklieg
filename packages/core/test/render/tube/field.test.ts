import { describe, expect, it } from 'vitest';
import { isoContours, type Point2, signedDistanceField } from '../../../src/render/tube/field.js';

/** A 1x1 square centred on the origin, as a closed polygon. */
function square(): { x: number; y: number }[] {
  return [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 },
  ];
}

describe('signedDistanceField', () => {
  it('is negative inside and positive outside', () => {
    const f = signedDistanceField([square()], { resolution: 128, pad: 0.4 });
    expect(f.sample(0, 0)).toBeLessThan(0);
    expect(f.sample(0.9, 0.9)).toBeGreaterThan(0);
  });

  it('reports the distance to the edge, not to the cell class', () => {
    // The centre of a 1x1 square is 0.5 from every edge. A field seeded on the wrong side
    // collapses to zero everywhere, which is the failure this pins.
    const f = signedDistanceField([square()], { resolution: 256, pad: 0.4 });
    expect(f.sample(0, 0)).toBeCloseTo(-0.5, 1);
  });
});

describe('isoContours', () => {
  it('returns one closed loop for the outline of a square', () => {
    const f = signedDistanceField([square()], { resolution: 256, pad: 0.4 });
    const lines = isoContours(f, 0);
    expect(lines).toHaveLength(1);
    const line = lines[0] as Point2[];
    expect(line.length).toBeGreaterThan(8);
  });

  it('empties out once the level exceeds the shape half-width', () => {
    const f = signedDistanceField([square()], { resolution: 256, pad: 0.4 });
    expect(isoContours(f, -0.4).length).toBe(1);
    expect(isoContours(f, -0.6).length).toBe(0);
  });
});
