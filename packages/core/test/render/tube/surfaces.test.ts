import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { surfacesOf, wallPointAt } from '../../../src/render/tube/surfaces.js';

function square(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(-0.5, 0.5);
  s.closePath();
  return s;
}

function ring(): THREE.Shape {
  const outer = square();
  const hole = new THREE.Path();
  hole.moveTo(-0.2, -0.2);
  hole.lineTo(-0.2, 0.2);
  hole.lineTo(0.2, 0.2);
  hole.lineTo(0.2, -0.2);
  hole.closePath();
  outer.holes.push(hole);
  return outer;
}

describe('surfacesOf', () => {
  it('gives a front, a back and one wall per contour', () => {
    const one = surfacesOf([square()], 0.3);
    expect(one.filter((s) => s.kind === 'front')).toHaveLength(1);
    expect(one.filter((s) => s.kind === 'back')).toHaveLength(1);
    expect(one.filter((s) => s.kind === 'wall')).toHaveLength(1);

    const two = surfacesOf([ring()], 0.3);
    expect(two.filter((s) => s.kind === 'wall')).toHaveLength(2);
  });
});

describe('wallPointAt', () => {
  it('wraps arc length instead of clamping it', () => {
    const wall = surfacesOf([square()], 0.3).find((s) => s.kind === 'wall');
    if (wall?.kind !== 'wall') throw new Error('no wall');

    // A step across the seam must be a small move in 3D, not a jump across the letter.
    const before = wallPointAt(wall, wall.perimeter - 0.01, 0.5);
    const after = wallPointAt(wall, 0.01, 0.5);
    expect(before.distanceTo(after)).toBeLessThan(0.1);
  });

  it('wraps arc length past the perimeter rather than clamping', () => {
    const wall = surfacesOf([square()], 0.3).find((s) => s.kind === 'wall');
    if (!wall || wall.kind !== 'wall') throw new Error('no wall');

    // A generator walking a running arc-length counter overshoots the perimeter; clamping there
    // would pile every subsequent point onto the seam instead of continuing around.
    const base = wallPointAt(wall, 0.02, 0.5);
    expect(wallPointAt(wall, wall.perimeter + 0.02, 0.5).distanceTo(base)).toBeLessThan(1e-9);
    expect(wallPointAt(wall, -wall.perimeter + 0.02, 0.5).distanceTo(base)).toBeLessThan(1e-9);
  });

  it('places depth between the back and front planes', () => {
    const wall = surfacesOf([square()], 0.3).find((s) => s.kind === 'wall');
    if (wall?.kind !== 'wall') throw new Error('no wall');
    expect(wallPointAt(wall, 0, 0).z).toBeCloseTo(0, 5);
    expect(wallPointAt(wall, 0, 1).z).toBeCloseTo(0.3, 5);
  });
});
