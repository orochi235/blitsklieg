import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generatePaths } from '../../../src/render/tube/generators.js';
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

const OPTS = { level: 0, spacing: 0.02, wallDepth: 0.5, resolution: 192, pad: 0.4 };

describe('generatePaths', () => {
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
