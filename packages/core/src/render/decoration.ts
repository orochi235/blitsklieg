import * as THREE from 'three';
import type { LookSpec } from './looks.js';

/** A decoration's own material, in the same plain numbers a look takes. */
export type MaterialSpec = Omit<LookSpec, 'decoration' | 'bloom'>;

export interface TubeSpec {
  kind: 'tube';
  /** Tube radius, in em. */
  radius: number;
  /** Depth fractions to sweep a loop at. `[1]` is the front face. */
  at: number[];
  /** Ring segments around the tube. */
  segments: number;
  /** How far inside the glyph the path runs, in em. 0 rides the outline itself. */
  inset?: number;
  look: MaterialSpec;
}

export interface TubeBlueprint {
  kind: 'tube';
  loops: THREE.BufferGeometry[];
  dispose(): void;
}

const CONTOUR_SEGMENTS = 48;

// `getPoints` repeats the opening point on a closed contour. Left in, that coincident knot is a
// degenerate segment the closed spline bulges around, and the loop comes out visibly lopsided.
function contourPoints(contour: THREE.Shape | THREE.Path): THREE.Vector2[] {
  const points = contour.getPoints(CONTOUR_SEGMENTS);
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first && last && first.distanceTo(last) < 1e-6) points.pop();
  return points;
}

function signedArea(points: THREE.Vector2[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const p = points[i] as THREE.Vector2;
    const q = points[j] as THREE.Vector2;
    sum += q.x * p.y - p.x * q.y;
  }
  return sum / 2;
}

/** Beyond this a sharp corner's miter shoots off to infinity, so the spike is clamped instead. */
const MITER_LIMIT = 4;

/**
 * Walks each vertex along its angle bisector into the solid, so the tube sits inside the letter
 * rather than straddling its edge. A stroke thinner than twice the inset turns itself inside out;
 * that shows up as a flipped signed area, and the contour is dropped rather than drawn as a bowtie.
 */
function insetContour(points: THREE.Vector2[], distance: number, hole: boolean): THREE.Vector2[] {
  const area = signedArea(points);
  if (area === 0) return [];
  // Left of travel is the interior of a counter-clockwise ring; a hole's solid is the other way.
  const sign = (area > 0 ? 1 : -1) * (hole ? -1 : 1);
  const out: THREE.Vector2[] = [];

  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length] as THREE.Vector2;
    const cur = points[i] as THREE.Vector2;
    const next = points[(i + 1) % points.length] as THREE.Vector2;

    const back = new THREE.Vector2().subVectors(cur, prev).normalize();
    const forward = new THREE.Vector2().subVectors(next, cur).normalize();
    const normalBack = new THREE.Vector2(-back.y, back.x);
    const normalForward = new THREE.Vector2(-forward.y, forward.x);

    const bisector = new THREE.Vector2().addVectors(normalBack, normalForward);
    if (bisector.lengthSq() < 1e-12) continue;
    bisector.normalize();

    const miter = Math.min(1 / Math.max(bisector.dot(normalBack), 1e-3), MITER_LIMIT);
    out.push(
      new THREE.Vector2(
        cur.x + bisector.x * miter * distance * sign,
        cur.y + bisector.y * miter * distance * sign,
      ),
    );
  }

  if (out.length !== points.length || out.length < 3) return [];

  // Signed area cannot see this: over-insetting a symmetric contour point-reflects it, and a
  // 180 degree rotation keeps the winding it started with. A collapsed edge reverses instead.
  for (let i = 0; i < out.length; i++) {
    const next = (i + 1) % out.length;
    const before = new THREE.Vector2().subVectors(
      points[next] as THREE.Vector2,
      points[i] as THREE.Vector2,
    );
    const after = new THREE.Vector2().subVectors(
      out[next] as THREE.Vector2,
      out[i] as THREE.Vector2,
    );
    if (before.dot(after) < 0) return [];
  }
  return out;
}

export function buildTubeBlueprint(
  shapes: THREE.Shape[],
  spec: TubeSpec,
  depth: number,
): TubeBlueprint {
  const loops: THREE.BufferGeometry[] = [];

  for (const shape of shapes) {
    for (const [index, contour] of [shape, ...shape.holes].entries()) {
      const traced = contourPoints(contour);
      if (traced.length < 3) continue;
      const points = spec.inset ? insetContour(traced, spec.inset, index > 0) : traced;
      if (points.length < 3) continue;

      for (const at of spec.at) {
        const z = at * depth;
        // Catmull-Rom rounds the corners of an `E`. That is correct here: neon tube cannot bend
        // square, and cord piping does not either.
        const curve = new THREE.CatmullRomCurve3(
          points.map((p) => new THREE.Vector3(p.x, p.y, z)),
          true,
          'centripetal',
        );
        loops.push(
          new THREE.TubeGeometry(curve, points.length * 2, spec.radius, spec.segments, true),
        );
      }
    }
  }

  return {
    kind: 'tube',
    loops,
    dispose() {
      for (const loop of loops) loop.dispose();
      loops.length = 0;
    },
  };
}

export interface ChunkSpec {
  kind: 'chunks';
  /** Chunks per letter. */
  count: number;
  /** Chunk edge, in em. */
  size: number;
  shape: 'flake' | 'cube';
  /** 0 free tumble, 1 one shared lattice per letter. */
  align: number;
  /** 0 even scatter, 1 tight intergrown clumps. */
  cluster: number;
  /** How far a chunk sits proud of the surface, 0..1. */
  proud: number;
  look: MaterialSpec;
}

export interface ChunkBlueprint {
  kind: 'chunks';
  position: Float32Array;
  normal: Float32Array;
  dispose(): void;
}

export type DecorationSpec = TubeSpec | ChunkSpec;
export type Blueprint = TubeBlueprint | ChunkBlueprint;

/** How many surface samples a char shares. Letters draw their own chunks from this pool. */
const POOL = 512;
/** Fixed, so a char's pool is identical across words and across runs. */
const POOL_SEED = 0x5eed;
/** How wide a clustered draw reaches around its anchor, in pool samples. */
const CLUSTER_NEIGHBOURS = 12;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildChunkBlueprint(geometry: THREE.BufferGeometry, pool = POOL): ChunkBlueprint {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  const vertexAt = (i: number) => (index ? index.getX(i) : i);
  const triangles = (index ? index.count : positions.count) / 3;

  // Area-weighted, so the bevel band's many small triangles do not out-vote the large faces.
  const cumulative = new Float32Array(triangles);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let total = 0;
  for (let t = 0; t < triangles; t++) {
    a.fromBufferAttribute(positions, vertexAt(t * 3));
    b.fromBufferAttribute(positions, vertexAt(t * 3 + 1));
    c.fromBufferAttribute(positions, vertexAt(t * 3 + 2));
    total += b.sub(a).cross(c.sub(a)).length() / 2;
    cumulative[t] = total;
  }

  const pick = (target: number) => {
    let lo = 0;
    let hi = triangles - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cumulative[mid] as number) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const random = rng(POOL_SEED);
  const position = new Float32Array(pool * 3);
  const normal = new Float32Array(pool * 3);
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nc = new THREE.Vector3();

  for (let s = 0; s < pool; s++) {
    const t = pick(random() * total);
    let u = random();
    let v = random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;

    a.fromBufferAttribute(positions, vertexAt(t * 3));
    b.fromBufferAttribute(positions, vertexAt(t * 3 + 1));
    c.fromBufferAttribute(positions, vertexAt(t * 3 + 2));
    na.fromBufferAttribute(normals, vertexAt(t * 3));
    nb.fromBufferAttribute(normals, vertexAt(t * 3 + 1));
    nc.fromBufferAttribute(normals, vertexAt(t * 3 + 2));

    position[s * 3] = a.x * w + b.x * u + c.x * v;
    position[s * 3 + 1] = a.y * w + b.y * u + c.y * v;
    position[s * 3 + 2] = a.z * w + b.z * u + c.z * v;
    na.multiplyScalar(w).addScaledVector(nb, u).addScaledVector(nc, v).normalize();
    normal[s * 3] = na.x;
    normal[s * 3 + 1] = na.y;
    normal[s * 3 + 2] = na.z;
  }

  return { kind: 'chunks', position, normal, dispose() {} };
}

function randomQuaternion(random: () => number): THREE.Quaternion {
  // Shoemake's uniform quaternion sampling; Euler angles from three uniform numbers cluster.
  const u1 = random();
  const u2 = random() * Math.PI * 2;
  const u3 = random() * Math.PI * 2;
  const r1 = Math.sqrt(1 - u1);
  const r2 = Math.sqrt(u1);
  return new THREE.Quaternion(
    r1 * Math.sin(u2),
    r1 * Math.cos(u2),
    r2 * Math.sin(u3),
    r2 * Math.cos(u3),
  );
}

export function chunkMatrices(
  blueprint: ChunkBlueprint,
  spec: ChunkSpec,
  seed: number,
): THREE.Matrix4[] {
  const random = rng(Math.round(seed * 2654435761) ^ POOL_SEED);
  const pool = blueprint.position.length / 3;
  const lattice = randomQuaternion(random);

  const chosen: number[] = [];
  const taken = new Set<number>();
  const sample = new THREE.Vector3();
  const other = new THREE.Vector3();

  for (let n = 0; n < spec.count; n++) {
    let index = Math.min(pool - 1, Math.floor(random() * pool));
    // Clustering draws near an already-placed chunk instead of anywhere, which is what leaves
    // bare matrix between clumps rather than an even sprinkle. Taking the single nearest sample
    // instead of one of the k nearest collapses the clump: that map is symmetric, so the draw
    // ping-pongs between one pair of samples forever.
    if (chosen.length > 0 && random() < spec.cluster) {
      const anchor = chosen[Math.floor(random() * chosen.length)] as number;
      sample.set(
        blueprint.position[anchor * 3] as number,
        blueprint.position[anchor * 3 + 1] as number,
        blueprint.position[anchor * 3 + 2] as number,
      );
      const near: number[] = [];
      const far: number[] = [];
      for (let p = 0; p < pool; p++) {
        if (taken.has(p)) continue;
        other.set(
          blueprint.position[p * 3] as number,
          blueprint.position[p * 3 + 1] as number,
          blueprint.position[p * 3 + 2] as number,
        );
        const d = other.distanceToSquared(sample);
        let slot = near.length;
        while (slot > 0 && (far[slot - 1] as number) > d) slot--;
        if (slot < CLUSTER_NEIGHBOURS) {
          near.splice(slot, 0, p);
          far.splice(slot, 0, d);
          if (near.length > CLUSTER_NEIGHBOURS) {
            near.pop();
            far.pop();
          }
        }
      }
      index = near[Math.floor(random() * near.length)] ?? index;
    }
    // Probing rather than redrawing: an exhausted pool then degrades to a repeat instead of
    // spinning, and the walk cannot desynchronize the seeded draw sequence.
    for (let probe = 0; taken.has(index) && probe < pool; probe++) index = (index + 1) % pool;
    chosen.push(index);
    taken.add(index);
  }

  const matrices: THREE.Matrix4[] = [];
  const scale = new THREE.Vector3(spec.size, spec.size, spec.size);

  for (const index of chosen) {
    const position = new THREE.Vector3(
      blueprint.position[index * 3] as number,
      blueprint.position[index * 3 + 1] as number,
      blueprint.position[index * 3 + 2] as number,
    );
    const normal = new THREE.Vector3(
      blueprint.normal[index * 3] as number,
      blueprint.normal[index * 3 + 1] as number,
      blueprint.normal[index * 3 + 2] as number,
    );
    position.addScaledVector(normal, spec.size * spec.proud);

    const rotation = randomQuaternion(random).slerp(lattice, spec.align);
    matrices.push(new THREE.Matrix4().compose(position, rotation, scale));
  }

  return matrices;
}

export function chunkGeometry(shape: ChunkSpec['shape']): THREE.BufferGeometry {
  return shape === 'cube' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.PlaneGeometry(1, 1);
}

/** A flake is one open quad, so culling its back face hides every chunk that tumbled away. */
export function chunkGeometrySide(shape: ChunkSpec['shape']): THREE.Side {
  return shape === 'cube' ? THREE.FrontSide : THREE.DoubleSide;
}
