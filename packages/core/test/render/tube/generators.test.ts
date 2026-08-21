import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateConnectors, generatePaths } from '../../../src/render/tube/generators.js';
import { surfacesOf } from '../../../src/render/tube/surfaces.js';

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

const OPTS = { level: 0, spacing: 0.02, wallDepth: 0.5, resolution: 192, pad: 0.4 };

describe('generatePaths', () => {
  it('insets a direct trace whichever way the caller wound the ring', () => {
    const extent = (shape: THREE.Shape) => {
      const paths = generatePaths(surfacesOf([shape], 0.3), ['front'], {
        ...OPTS,
        level: -0.1,
        source: 'direct',
      });
      return Math.max(...paths.flatMap((p) => p.points.map((q) => Math.abs(q.x))));
    };
    const reversed = new THREE.Shape();
    reversed.moveTo(-0.5, 0.5);
    reversed.lineTo(0.5, 0.5);
    reversed.lineTo(0.5, -0.5);
    reversed.lineTo(-0.5, -0.5);
    reversed.closePath();
    // Corner vertices carry a diagonal normal, so an inset lands a little above 0.4 rather than on
    // it, and the two windings resample from different corners. An outset would read 0.57.
    for (const measured of [extent(square()), extent(reversed)]) {
      expect(measured).toBeGreaterThan(0.4);
      expect(measured).toBeLessThan(0.45);
    }
  });

  it('emits nothing for surfaces that were not requested', () => {
    const surfaces = surfacesOf([square()], 0.3);
    expect(generatePaths(surfaces, [], OPTS)).toHaveLength(0);
  });

  it('puts front-face paths at the front plane', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front'], OPTS);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      for (const p of path.points) expect(p.z).toBeCloseTo(0.3, 5);
    }
  });

  it('emits 3D polylines on the wall that vary in z when asked to', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['wall'], { ...OPTS, wallRise: 0.4 });
    expect(paths.length).toBeGreaterThan(0);
    const zs = (paths[0]?.points ?? []).map((p) => p.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.01);
  });

  it('records which surface each path came from', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front', 'back'], OPTS);
    expect(new Set(paths.map((p) => p.surface))).toEqual(new Set(['front', 'back']));
  });
});

describe('generateConnectors', () => {
  it('emits nothing unless two surfaces are present', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const frontOnly = generatePaths(surfaces, ['front'], OPTS);
    expect(generateConnectors(frontOnly, { count: 3, overshoot: 0.05 })).toHaveLength(0);
  });

  it('joins front paths to back paths', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front', 'back'], OPTS);
    const links = generateConnectors(paths, { count: 3, overshoot: 0.05 });
    expect(links).toHaveLength(3);
    for (const link of links) expect(link.surface).toBe('connector');
  });

  it('runs mostly along z', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front', 'back'], OPTS);
    const link = generateConnectors(paths, { count: 1, overshoot: 0.05 })[0];
    if (!link) throw new Error('no connector');
    const a = link.points[0];
    const b = link.points[link.points.length - 1];
    if (!a || !b) throw new Error('empty connector');
    expect(Math.abs(b.z - a.z)).toBeGreaterThan(Math.hypot(b.x - a.x, b.y - a.y));
  });

  it('overshoots past the back plane so the tube disappears into the backing', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front', 'back'], OPTS);
    const link = generateConnectors(paths, { count: 1, overshoot: 0.05 })[0];
    if (!link) throw new Error('no connector');
    const zs = link.points.map((p) => p.z);
    expect(Math.min(...zs)).toBeLessThan(0);
  });

  it('is open, not closed', () => {
    const surfaces = surfacesOf([square()], 0.3);
    const paths = generatePaths(surfaces, ['front', 'back'], OPTS);
    for (const link of generateConnectors(paths, { count: 2, overshoot: 0.05 })) {
      expect(link.closed).toBe(false);
    }
  });

  it('emits count connectors per front path, not count total', () => {
    const surfaces = surfacesOf([ring()], 0.3);
    const paths = generatePaths(surfaces, ['front', 'back'], OPTS);
    const frontPaths = paths.filter((p) => p.surface === 'front');
    expect(frontPaths.length).toBe(2);
    const links = generateConnectors(paths, { count: 3, overshoot: 0.05 });
    expect(links).toHaveLength(3 * frontPaths.length);
  });
});
