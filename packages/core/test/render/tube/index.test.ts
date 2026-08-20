import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTubeBlueprint, type TubeSpec } from '../../../src/render/tube/index.js';

const SPEC: TubeSpec = {
  kind: 'tube',
  radius: 0.03,
  segments: 6,
  spacing: 0.02,
  surfaces: ['front'],
  level: 0,
  runs: 6,
  minRun: 0.05,
  select: { by: 'seed', amount: 1 },
  colors: [0xff2d95],
  look: {},
  dark: {},
};

function square(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(-0.5, 0.5);
  s.closePath();
  return s;
}

describe('buildTubeBlueprint', () => {
  it('produces lit geometry and a run list', () => {
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0);
    expect(bp.kind).toBe('tube');
    expect(bp.runs.length).toBeGreaterThan(0);
    expect(bp.lit.length).toBeGreaterThan(0);
    bp.dispose();
  });

  it('gives unlit runs their own geometry rather than skipping them', () => {
    const bp = buildTubeBlueprint(
      [square()],
      { ...SPEC, select: { by: 'seed', amount: 0.5 } },
      0.3,
      0,
    );
    expect(bp.dark.length).toBeGreaterThan(0);
    expect(bp.lit.length + bp.dark.length).toBe(bp.runs.length);
    bp.dispose();
  });

  it('is stable across two builds with the same seed', () => {
    const a = buildTubeBlueprint([square()], SPEC, 0.3, 3);
    const b = buildTubeBlueprint([square()], SPEC, 0.3, 3);
    expect(a.runs.map((r) => [r.index, r.lit, r.color])).toEqual(
      b.runs.map((r) => [r.index, r.lit, r.color]),
    );
    a.dispose();
    b.dispose();
  });

  it('empties out rather than throwing when the level exceeds the glyph', () => {
    const bp = buildTubeBlueprint([square()], { ...SPEC, level: -2 }, 0.3, 0);
    expect(bp.runs).toHaveLength(0);
    expect(bp.lit).toHaveLength(0);
    bp.dispose();
  });

  it('does not reach the distance field for a glyph that drew no contours', () => {
    // A space character passes an empty shape list; signedDistanceField throws on empty
    // polygons, so surfacesOf returning [] must short-circuit generatePaths before it gets there.
    const bp = buildTubeBlueprint([], SPEC, 0.3, 0);
    expect(bp.runs).toHaveLength(0);
    bp.dispose();
  });

  it('stays uncut through corners with an all-connect distribution', () => {
    const cut = buildTubeBlueprint([square()], { ...SPEC, runs: 1 }, 0.3, 0);
    const uncut = buildTubeBlueprint(
      [square()],
      { ...SPEC, runs: 1, corners: { break: 0, connect: 1, loop: 0 } },
      0.3,
      0,
    );
    expect(cut.runs.length).toBeGreaterThan(1);
    expect(uncut.runs).toHaveLength(1);
    cut.dispose();
    uncut.dispose();
  });

  it('does not pinch the depth wander at a corner an all-connect distribution carries through', () => {
    const bp = buildTubeBlueprint(
      [square()],
      { ...SPEC, runs: 1, corners: { break: 0, connect: 1, loop: 0 }, amplitude: 0.02 },
      0.3,
      0,
    );
    const run = bp.runs[0] as (typeof bp.runs)[number];
    // The run now carries through all four corners of the square rather than ending at them, so
    // z should wander away from the flat plane at interior points, not just pin to it.
    const interior = run.points.slice(1, -1);
    expect(interior.some((p) => Math.abs(p.z - (run.points[0] as THREE.Vector3).z) > 1e-6)).toBe(
      true,
    );
    bp.dispose();
  });

  it('leaves runs flat by default, and bends them once amplitude is set', () => {
    const flat = buildTubeBlueprint([square()], SPEC, 0.3, 0);
    const wandered = buildTubeBlueprint([square()], { ...SPEC, amplitude: 0.02 }, 0.3, 0);

    expect(
      flat.runs.every((r) => r.points.every((p) => p.z === (r.points[0] as THREE.Vector3).z)),
    ).toBe(true);
    expect(
      wandered.runs.some((r) => r.points.some((p) => p.z !== (r.points[0] as THREE.Vector3).z)),
    ).toBe(true);
    flat.dispose();
    wandered.dispose();
  });

  it('emits connectors between front and back when both faces are enabled', () => {
    const spec: TubeSpec = {
      ...SPEC,
      surfaces: ['front', 'back'],
      runs: 12,
      minRun: 0.01,
      connectors: 2,
    };
    const withConnectors = buildTubeBlueprint([square()], spec, 0.3, 0);
    const without = buildTubeBlueprint([square()], { ...spec, connectors: 0 }, 0.3, 0);
    expect(withConnectors.runs.some((r) => r.surface === 'connector')).toBe(true);
    expect(without.runs.some((r) => r.surface === 'connector')).toBe(false);
    withConnectors.dispose();
    without.dispose();
  });

  it('carries a corner record for every corner the cut decided', () => {
    const spec: TubeSpec = { ...SPEC, corners: { break: 0, connect: 1, loop: 0 } };
    const blueprint = buildTubeBlueprint([square()], spec, 0.3, 1);

    expect(blueprint.corners.length).toBeGreaterThan(0);
    for (const corner of blueprint.corners) expect(corner.strategy).toBe('connect');
    blueprint.dispose();
  });

  it('tracks a corner record onto the wandered run it sits on, not its pre-wander position', () => {
    const base: TubeSpec = {
      ...SPEC,
      corners: { break: 0, connect: 1, loop: 0 },
      minRun: 0,
      surfaces: ['front'],
    };
    const flat = buildTubeBlueprint([square()], { ...base, amplitude: 0 }, 0.3, 1);
    const wandered = buildTubeBlueprint([square()], { ...base, amplitude: 0.05 }, 0.3, 1);

    for (const corner of wandered.corners) {
      const minDist = Math.min(
        ...wandered.runs.flatMap((r) => r.points.map((p) => p.distanceTo(corner.point))),
      );
      expect(minDist).toBeLessThan(1e-9);
    }

    const flatZ = flat.corners.map((c) => c.point.z);
    const wanderedZ = wandered.corners.map((c) => c.point.z);
    expect(wanderedZ.some((z, i) => z !== flatZ[i])).toBe(true);

    flat.dispose();
    wandered.dispose();
  });
});
