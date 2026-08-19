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

/** A square ring: a 1x1 outer square with a 0.3x0.3 hole, as two polygons like an 'O'. */
function ring(): { x: number; y: number }[][] {
  return [
    square(),
    [
      { x: -0.15, y: -0.15 },
      { x: 0.15, y: -0.15 },
      { x: 0.15, y: 0.15 },
      { x: -0.15, y: 0.15 },
    ],
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

  it('cuts a hole with even-odd fill across multiple contours', () => {
    // A glyph counter (the hole in O, B, A, D, P, Q, R) is a second polygon inside the first.
    const f = signedDistanceField(ring(), { resolution: 256, pad: 0.4 });
    expect(f.sample(0, 0)).toBeGreaterThan(0); // hole centre: outside
    expect(f.sample(0.3, 0)).toBeLessThan(0); // ring between the two squares: inside
  });

  it('throws on an empty polygon list instead of returning a garbage field', () => {
    expect(() => signedDistanceField([], { resolution: 128, pad: 0.4 })).toThrow();
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

  it('returns two loops for a ring, one per boundary', () => {
    const f = signedDistanceField(ring(), { resolution: 256, pad: 0.4 });
    expect(isoContours(f, 0)).toHaveLength(2);
  });
});
