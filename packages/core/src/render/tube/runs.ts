import type * as THREE from 'three';
import type { GeneratedPath } from './generators.js';
import type { SurfaceKind } from './surfaces.js';

export interface Run {
  points: THREE.Vector3[];
  surface: SurfaceKind;
  length: number;
  /** Position in the run list. Stable across builds, so a post-effect can address a run by it. */
  index: number;
  lit: boolean;
  color: number;
}

export interface CutOptions {
  /** Requested run count per glyph. Cannot go below the corner count. */
  runs: number;
  /** Runs shorter than this are dropped and left dark, in em. */
  minRun: number;
  /** Tangent break counted as a corner, in radians. */
  cornerAngle?: number;
}

const DEFAULT_CORNER = Math.PI / 6;

function polyLength(points: THREE.Vector3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += (points[i] as THREE.Vector3).distanceTo(points[i - 1] as THREE.Vector3);
  }
  return total;
}

interface Break {
  index: number;
  turn: number;
}

/**
 * Indices where the direction breaks by more than `angle`, with adjacent breaks merged to their
 * sharpest vertex. A closed path tests every index including 0 (wrapping to `points[n - 1]` as
 * its predecessor); an open path never treats its own endpoints as corners.
 */
function cornersOf(points: THREE.Vector3[], closed: boolean, angle: number): number[] {
  const n = points.length;
  if (n < 3) return [];
  const broken: Break[] = [];
  const count = closed ? n : n - 2;
  const first = closed ? 0 : 1;
  for (let k = 0; k < count; k++) {
    const i = first + k;
    const prev = points[(i - 1 + n) % n] as THREE.Vector3;
    const cur = points[i] as THREE.Vector3;
    const next = points[(i + 1) % n] as THREE.Vector3;
    const a = cur.clone().sub(prev);
    const b = next.clone().sub(cur);
    if (a.lengthSq() < 1e-18 || b.lengthSq() < 1e-18) continue;
    const turn = a.normalize().angleTo(b.normalize());
    if (turn > angle) broken.push({ index: i, turn });
  }
  if (broken.length === 0) return [];

  // Collapse each run of consecutive indices to its sharpest vertex.
  const groups: Break[][] = [[broken[0] as Break]];
  for (let k = 1; k < broken.length; k++) {
    const b = broken[k] as Break;
    const group = groups[groups.length - 1] as Break[];
    const prev = group[group.length - 1] as Break;
    if (b.index === prev.index + 1) group.push(b);
    else groups.push([b]);
  }
  // On a closed path a corner straddling the seam splits into a group ending at n - 1 and one
  // starting at 0; they are adjacent by wraparound and belong to the same corner.
  if (closed && groups.length > 1) {
    const firstGroup = groups[0] as Break[];
    const lastGroup = groups[groups.length - 1] as Break[];
    if (firstGroup[0]?.index === 0 && lastGroup[lastGroup.length - 1]?.index === n - 1) {
      groups[0] = lastGroup.concat(firstGroup);
      groups.pop();
    }
  }

  return groups.map((group) => group.reduce((a, b) => (b.turn > a.turn ? b : a)).index);
}

/**
 * The points from index `start` to `end` (inclusive), walking forward and wrapping through 0 on
 * a closed path. `start === end` (a single corner) walks the whole loop back to itself.
 */
function arc(points: THREE.Vector3[], start: number, end: number): THREE.Vector3[] {
  const n = points.length;
  const steps = end > start ? end - start : n - start + end;
  const span: THREE.Vector3[] = [];
  for (let s = 0; s <= steps; s++) {
    span.push(points[(start + s) % n] as THREE.Vector3);
  }
  return span;
}

function spansOf(path: GeneratedPath, angle: number): THREE.Vector3[][] {
  const { points, closed } = path;
  const corners = cornersOf(points, closed, angle);

  if (corners.length === 0) {
    return [closed ? [...points, points[0] as THREE.Vector3] : points.slice()];
  }

  const spans: THREE.Vector3[][] = [];
  if (closed) {
    for (let k = 0; k < corners.length; k++) {
      const start = corners[k] as number;
      const end = corners[(k + 1) % corners.length] as number;
      spans.push(arc(points, start, end));
    }
  } else {
    const cuts = [0, ...corners, points.length - 1];
    for (let k = 0; k < cuts.length - 1; k++) {
      const start = cuts[k] as number;
      const end = cuts[k + 1] as number;
      if (end > start) spans.push(points.slice(start, end + 1));
    }
  }
  return spans.filter((span) => span.length > 1);
}

function slice(span: THREE.Vector3[], pieces: number): THREE.Vector3[][] {
  if (pieces <= 1) return [span];
  const per = polyLength(span) / pieces;
  const out: THREE.Vector3[][] = [];
  let acc = 0;
  let cur: THREE.Vector3[] = [span[0] as THREE.Vector3];
  for (let i = 1; i < span.length; i++) {
    acc += (span[i] as THREE.Vector3).distanceTo(span[i - 1] as THREE.Vector3);
    cur.push(span[i] as THREE.Vector3);
    if (acc >= per && out.length < pieces - 1 && i < span.length - 1) {
      out.push(cur);
      cur = [span[i] as THREE.Vector3];
      acc = 0;
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/**
 * Corners are mandatory cuts; `runs` inserts the rest, distributed across spans by length with
 * largest remainder. The count is a request, not a guarantee — it cannot go below the corner
 * count, and the floor can take the result lower still.
 */
export function cutIntoRuns(paths: GeneratedPath[], opts: CutOptions): Run[] {
  const angle = opts.cornerAngle ?? DEFAULT_CORNER;
  const spans: { points: THREE.Vector3[]; surface: SurfaceKind }[] = [];
  for (const path of paths) {
    for (const span of spansOf(path, angle)) spans.push({ points: span, surface: path.surface });
  }
  if (spans.length === 0) return [];

  const lengths = spans.map((s) => polyLength(s.points));
  const total = lengths.reduce((a, b) => a + b, 0);
  const extra = Math.max(0, opts.runs - spans.length);
  const want = lengths.map((l) => (total > 0 ? (extra * l) / total : 0));
  const base = want.map(Math.floor);
  let left = extra - base.reduce((a, b) => a + b, 0);
  for (const [, i] of want
    .map((w, i) => [w - (base[i] as number), i] as const)
    .sort((a, b) => b[0] - a[0])) {
    if (left <= 0) break;
    base[i] = (base[i] as number) + 1;
    left--;
  }

  const out: Run[] = [];
  spans.forEach((span, i) => {
    for (const piece of slice(span.points, 1 + (base[i] as number))) {
      const length = polyLength(piece);
      if (length < opts.minRun) continue;
      out.push({
        points: piece,
        surface: span.surface,
        length,
        index: out.length,
        lit: true,
        color: 0,
      });
    }
  });
  return out;
}
