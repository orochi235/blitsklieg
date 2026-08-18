import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTubeBlueprint, type TubeSpec } from '../../src/render/decoration.js';

const SPEC: TubeSpec = {
  kind: 'tube',
  radius: 0.04,
  at: [1],
  segments: 6,
  look: {},
};

/** A square with a square counter — the topology of an `O`. */
function ring(): THREE.Shape {
  const outer = new THREE.Shape();
  outer.moveTo(-0.5, -0.5);
  outer.lineTo(0.5, -0.5);
  outer.lineTo(0.5, 0.5);
  outer.lineTo(-0.5, 0.5);
  outer.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-0.2, -0.2);
  hole.lineTo(-0.2, 0.2);
  hole.lineTo(0.2, 0.2);
  hole.lineTo(0.2, -0.2);
  hole.closePath();
  outer.holes.push(hole);

  return outer;
}

/** A plain square — the topology of an `E`, one contour and no counter. */
function slab(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(-0.5, 0.5);
  s.closePath();
  return s;
}

describe('buildTubeBlueprint', () => {
  it('pipes the counter as well as the outline', () => {
    const blueprint = buildTubeBlueprint([ring()], SPEC, 0.3);

    expect(blueprint.loops).toHaveLength(2);
  });

  it('gives a contour-free shape one loop', () => {
    const blueprint = buildTubeBlueprint([slab()], SPEC, 0.3);

    expect(blueprint.loops).toHaveLength(1);
  });

  it('sweeps one loop per contour per depth fraction', () => {
    const blueprint = buildTubeBlueprint([ring()], { ...SPEC, at: [0, 1] }, 0.3);

    expect(blueprint.loops).toHaveLength(4);
  });

  it('places a loop at the depth fraction it was given', () => {
    const front = buildTubeBlueprint([slab()], { ...SPEC, at: [1] }, 0.3);
    front.loops[0]?.computeBoundingBox();

    expect(front.loops[0]?.boundingBox?.max.z).toBeCloseTo(0.3 + SPEC.radius, 2);
  });

  it('produces finite vertices, never NaN from a duplicated closing point', () => {
    const blueprint = buildTubeBlueprint([ring()], SPEC, 0.3);
    const position = blueprint.loops[0]?.getAttribute('position');
    const array = position?.array as Float32Array;

    expect(array.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('releases every loop on dispose', () => {
    const blueprint = buildTubeBlueprint([ring()], SPEC, 0.3);
    const disposed: THREE.BufferGeometry[] = [];
    for (const loop of blueprint.loops) {
      loop.addEventListener('dispose', () => disposed.push(loop));
    }

    blueprint.dispose();

    expect(disposed).toHaveLength(2);
  });
});
