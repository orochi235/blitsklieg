import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildChunkBlueprint,
  buildTubeBlueprint,
  type ChunkSpec,
  chunkMatrices,
  type TubeSpec,
} from '../../src/render/decoration.js';

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

  it('pulls the path inside the glyph when given an inset', () => {
    const on = buildTubeBlueprint([slab()], SPEC, 0.3);
    const inside = buildTubeBlueprint([slab()], { ...SPEC, inset: 0.15 }, 0.3);
    const width = (b: ReturnType<typeof buildTubeBlueprint>) => {
      const loop = b.loops[0] as THREE.BufferGeometry;
      loop.computeBoundingBox();
      return (loop.boundingBox as THREE.Box3).max.x;
    };

    expect(width(inside)).toBeLessThan(width(on) - 0.1);
  });

  it('drops a contour too thin to hold its inset rather than drawing a bowtie', () => {
    // The slab spans 1 em, so insetting by 0.6 from both sides turns it inside out.
    const collapsed = buildTubeBlueprint([slab()], { ...SPEC, inset: 0.6 }, 0.3);

    expect(collapsed.loops).toHaveLength(0);
  });

  it('insets a counter away from its hole, into the surrounding solid', () => {
    const inside = buildTubeBlueprint([ring()], { ...SPEC, inset: 0.05 }, 0.3);
    const counter = inside.loops[1] as THREE.BufferGeometry;
    counter.computeBoundingBox();

    // The hole spans +/-0.2; pushing into the solid grows the counter path, it does not shrink it.
    expect((counter.boundingBox as THREE.Box3).max.x).toBeGreaterThan(0.2);
  });

  it('closes the loop without a lopsided seam', () => {
    const blueprint = buildTubeBlueprint([slab()], SPEC, 0.3);
    const loop = blueprint.loops[0] as THREE.BufferGeometry;
    loop.computeBoundingBox();
    const box = loop.boundingBox as THREE.Box3;

    // A square pipes to a loop symmetric about both axes. Leaving the repeated closing point in
    // bulges the spline at the seam, which shows up here and nowhere else.
    expect(box.max.x).toBeCloseTo(-box.min.x, 6);
    expect(box.max.y).toBeCloseTo(-box.min.y, 6);
    expect(box.max.x).toBeCloseTo(box.max.y, 6);
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

const CHUNKS: ChunkSpec = {
  kind: 'chunks',
  count: 12,
  size: 0.05,
  shape: 'cube',
  align: 0,
  cluster: 0,
  proud: 0.5,
  look: {},
};

function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 0.3);
}

/** Rotation only, so two matrices can be compared for shared orientation. */
function quaternionOf(m: THREE.Matrix4): THREE.Quaternion {
  const q = new THREE.Quaternion();
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return q;
}

describe('buildChunkBlueprint', () => {
  it('samples positions and normals in step', () => {
    const blueprint = buildChunkBlueprint(box());

    expect(blueprint.position.length).toBe(blueprint.normal.length);
    expect(blueprint.position.length % 3).toBe(0);
  });

  it('samples the same pool for the same geometry every time', () => {
    const a = buildChunkBlueprint(box());
    const b = buildChunkBlueprint(box());

    expect(Array.from(a.position)).toEqual(Array.from(b.position));
  });

  it('places every sample on the surface', () => {
    const blueprint = buildChunkBlueprint(box());

    for (let i = 0; i < blueprint.position.length; i += 3) {
      const x = Math.abs(blueprint.position[i] as number);
      const y = Math.abs(blueprint.position[i + 1] as number);
      const z = Math.abs(blueprint.position[i + 2] as number);
      const onFace = x > 0.5 - 1e-6 || y > 0.5 - 1e-6 || z > 0.15 - 1e-6;
      expect(onFace).toBe(true);
    }
  });
});

describe('chunkMatrices', () => {
  it('produces one matrix per requested chunk', () => {
    const matrices = chunkMatrices(buildChunkBlueprint(box()), CHUNKS, 3);

    expect(matrices).toHaveLength(CHUNKS.count);
  });

  it('is deterministic for a given seed', () => {
    const blueprint = buildChunkBlueprint(box());
    const a = chunkMatrices(blueprint, CHUNKS, 3);
    const b = chunkMatrices(blueprint, CHUNKS, 3);

    expect(a[0]?.elements).toEqual(b[0]?.elements);
  });

  it('gives different letters different scatter', () => {
    const blueprint = buildChunkBlueprint(box());
    const a = chunkMatrices(blueprint, CHUNKS, 3);
    const b = chunkMatrices(blueprint, CHUNKS, 4);

    expect(a[0]?.elements).not.toEqual(b[0]?.elements);
  });

  it('shares one orientation across a letter at align 1', () => {
    const blueprint = buildChunkBlueprint(box());
    const matrices = chunkMatrices(blueprint, { ...CHUNKS, align: 1 }, 3);
    const first = quaternionOf(matrices[0] as THREE.Matrix4);

    for (const m of matrices) {
      expect(quaternionOf(m).angleTo(first)).toBeCloseTo(0, 5);
    }
  });

  it('tumbles freely at align 0', () => {
    const blueprint = buildChunkBlueprint(box());
    const matrices = chunkMatrices(blueprint, { ...CHUNKS, align: 0 }, 3);
    const first = quaternionOf(matrices[0] as THREE.Matrix4);
    const spread = matrices.map((m) => quaternionOf(m).angleTo(first));

    expect(Math.max(...spread)).toBeGreaterThan(0.1);
  });

  it('keeps a full clump from collapsing onto a couple of points', () => {
    const spec = { ...CHUNKS, count: 40, cluster: 1 };
    const matrices = chunkMatrices(buildChunkBlueprint(box()), spec, 3);
    const at = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
    const distinct = new Set(matrices.map((m) => at(m).toArray().join(',')));

    expect(distinct.size).toBeGreaterThan(spec.count / 2);
  });

  it('draws a clump tighter than an even scatter', () => {
    const blueprint = buildChunkBlueprint(box());
    const spread = (cluster: number) => {
      const matrices = chunkMatrices(blueprint, { ...CHUNKS, count: 40, cluster }, 3);
      const points = matrices.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
      const mean = points
        .reduce((acc, p) => acc.add(p), new THREE.Vector3())
        .divideScalar(points.length);
      return points.reduce((acc, p) => acc + p.distanceTo(mean), 0) / points.length;
    };

    expect(spread(1)).toBeLessThan(spread(0));
  });

  it('sits chunks proud of the surface', () => {
    const blueprint = buildChunkBlueprint(box());
    const flush = chunkMatrices(blueprint, { ...CHUNKS, proud: 0 }, 3);
    const raised = chunkMatrices(blueprint, { ...CHUNKS, proud: 1 }, 3);

    const at = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m).length();
    expect(at(raised[0] as THREE.Matrix4)).toBeGreaterThan(at(flush[0] as THREE.Matrix4));
  });
});
