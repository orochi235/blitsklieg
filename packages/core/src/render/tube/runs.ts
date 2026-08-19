import * as THREE from 'three';
import { seedNormal } from './frames.js';
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

export type CornerStrategy = 'break' | 'connect' | 'loop';

/** Relative weights over what a corner does; need not sum to 1. */
export interface CornerWeights {
  break: number;
  connect: number;
  loop: number;
}

/** Every corner cuts — today's only behavior, and the default when a spec sets nothing. */
export const ALL_BREAK: CornerWeights = { break: 1, connect: 0, loop: 0 };
/** Every corner bends through instead of cutting — a continuous cord, what `piping` wants. */
export const ALL_CONNECT: CornerWeights = { break: 0, connect: 1, loop: 0 };

export interface CutOptions {
  /** Requested run count per glyph. Cannot go below the corner count. */
  runs: number;
  /** Runs shorter than this are dropped and left dark, in em. */
  minRun: number;
  /** Weight distribution over what each corner does. Defaults to every corner breaking. */
  corners?: CornerWeights;
  /** Requested tube radius in em; an inserted loop is sized relative to it. */
  radius?: number;
  /** Seeds the per-corner strategy draw so a word builds identically twice. */
  seed?: number;
}

/** Tangent break counted as a corner at all, independent of what strategy runs there. */
const DEFAULT_CORNER = Math.PI / 6;
/** Loop radius as a multiple of the requested tube radius. sweepRadius's 0.8 curvature
 *  clearance needs >= 1.25x to preserve full radius through a loop; this sits well clear of it. */
const LOOP_RADIUS_FACTOR = 4;
const LOOP_SEGMENTS = 28;
/** A weight factor never fully zeroes an option biasing can't rule out entirely. */
const FLOOR = 0.05;
/** Turn past which glass is treated as unable to bend without kinking. */
const CONNECT_LIMIT = Math.PI * 0.75;
const FALLBACK_RADIUS = 0.03;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Same generator assign.ts and wander.ts use, so seeding behaves consistently pipeline-wide. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cornerSeed(seed: number, counter: number): number {
  return (Math.round(seed * 2654435761) ^ 0x2f2f6a3d ^ counter) >>> 0;
}

function polyLength(points: THREE.Vector3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += (points[i] as THREE.Vector3).distanceTo(points[i - 1] as THREE.Vector3);
  }
  return total;
}

interface CornerInfo {
  index: number;
  turn: number;
}

interface CornerDecision extends CornerInfo {
  strategy: CornerStrategy;
}

/**
 * Indices where the direction breaks by more than `angle`, with adjacent breaks merged to their
 * sharpest vertex. A closed path tests every index including 0 (wrapping to `points[n - 1]` as
 * its predecessor); an open path never treats its own endpoints as corners.
 */
function cornersOf(points: THREE.Vector3[], closed: boolean, angle: number): CornerInfo[] {
  const n = points.length;
  if (n < 3) return [];
  const broken: CornerInfo[] = [];
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
  const groups: CornerInfo[][] = [[broken[0] as CornerInfo]];
  for (let k = 1; k < broken.length; k++) {
    const b = broken[k] as CornerInfo;
    const group = groups[groups.length - 1] as CornerInfo[];
    const prev = group[group.length - 1] as CornerInfo;
    if (b.index === prev.index + 1) group.push(b);
    else groups.push([b]);
  }
  // On a closed path a corner straddling the seam splits into a group ending at n - 1 and one
  // starting at 0; they are adjacent by wraparound and belong to the same corner.
  if (closed && groups.length > 1) {
    const firstGroup = groups[0] as CornerInfo[];
    const lastGroup = groups[groups.length - 1] as CornerInfo[];
    if (firstGroup[0]?.index === 0 && lastGroup[lastGroup.length - 1]?.index === n - 1) {
      groups[0] = lastGroup.concat(firstGroup);
      groups.pop();
    }
  }

  return groups.map((group) => group.reduce((a, b) => (b.turn > a.turn ? b : a)));
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

interface RawSpans {
  /**
   * Points between consecutive corners. Closed: `arcs[k]` starts at `corners[k]` and ends at
   * `corners[(k + 1) % n]`, so `arcs.length === corners.length`. Open: `arcs[k]` ends at
   * `corners[k]` and `arcs[k + 1]` starts there, so `arcs.length === corners.length + 1`.
   */
  arcs: THREE.Vector3[][];
  corners: CornerInfo[];
}

function rawSpansOf(path: GeneratedPath, angle: number): RawSpans {
  const { points, closed } = path;
  const corners = cornersOf(points, closed, angle);

  if (corners.length === 0) {
    const whole = closed ? [...points, points[0] as THREE.Vector3] : points.slice();
    return { arcs: [whole], corners: [] };
  }

  if (closed) {
    const arcs: THREE.Vector3[][] = [];
    for (let k = 0; k < corners.length; k++) {
      const start = corners[k] as CornerInfo;
      const end = corners[(k + 1) % corners.length] as CornerInfo;
      arcs.push(arc(points, start.index, end.index));
    }
    return { arcs, corners };
  }

  const arcs: THREE.Vector3[][] = [];
  const cuts = [0, ...corners.map((c) => c.index), points.length - 1];
  for (let k = 0; k < cuts.length - 1; k++) {
    const start = cuts[k] as number;
    const end = cuts[k + 1] as number;
    arcs.push(points.slice(start, end + 1));
  }
  return { arcs, corners };
}

/**
 * Which strategy a corner draws, biased toward what the geometry can plausibly carry: a sharp
 * turn favors break, a shallow one favors connect, and loop needs both a turn to sit at and
 * straight tube on either side to loop through. A pure distribution (one weight nonzero) always
 * picks that one — the bias multiplies a weight, and multiplying zero by anything stays zero.
 */
function pickStrategy(
  turn: number,
  room: number,
  loopDiameter: number,
  weights: CornerWeights,
  draw: () => number,
): CornerStrategy {
  const wBreak = weights.break * clamp(turn / Math.PI, FLOOR, 1);
  const wConnect = weights.connect * clamp(1 - turn / CONNECT_LIMIT, FLOOR, 1);
  const roomFactor = clamp(room / (loopDiameter * 1.5), 0, 1);
  const turnFactor = clamp(turn / (Math.PI * 0.5), 0.3, 1);
  const wLoop = weights.loop * Math.max(FLOOR, roomFactor * turnFactor);

  const total = wBreak + wConnect + wLoop;
  if (total <= 0) return 'break';
  const r = draw() * total;
  if (r < wBreak) return 'break';
  if (r < wBreak + wConnect) return 'connect';
  return 'loop';
}

/**
 * A full turn spliced at `corner`, tangent-continuous with the incoming direction so it reads as
 * the path carrying past the corner rather than kinking into a new one. Excludes the corner point
 * itself (the caller already has it) but includes the closing point, which lands back on it.
 */
function buildLoop(
  corner: THREE.Vector3,
  tangentIn: THREE.Vector3,
  radius: number,
): THREE.Vector3[] {
  const v = seedNormal(tangentIn);
  const center = corner.clone().addScaledVector(v, radius);
  const points: THREE.Vector3[] = [];
  for (let s = 1; s <= LOOP_SEGMENTS; s++) {
    const theta = (s / LOOP_SEGMENTS) * Math.PI * 2;
    points.push(
      center
        .clone()
        .addScaledVector(v, -radius * Math.cos(theta))
        .addScaledVector(tangentIn, radius * Math.sin(theta)),
    );
  }
  return points;
}

/** The direction arriving at `corner`, falling back to the outgoing arc when there's no history. */
function tangentInto(
  corner: THREE.Vector3,
  before: THREE.Vector3 | undefined,
  after: THREE.Vector3 | undefined,
): THREE.Vector3 {
  if (before) {
    const d = corner.clone().sub(before);
    if (d.lengthSq() > 1e-18) return d.normalize();
  }
  if (after) {
    const d = after.clone().sub(corner);
    if (d.lengthSq() > 1e-18) return d.normalize();
  }
  return new THREE.Vector3(1, 0, 0);
}

/** Appends `next` onto `target`, which already ends at the shared corner; splices a loop first. */
function mergeArc(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  decision: CornerDecision,
  loopRadius: number,
): void {
  if (decision.strategy === 'loop') {
    const cornerPt = target[target.length - 1] as THREE.Vector3;
    const before = target[target.length - 2];
    const tangentIn = tangentInto(cornerPt, before, next[1]);
    for (const p of buildLoop(cornerPt, tangentIn, loopRadius)) target.push(p);
  }
  for (let i = 1; i < next.length; i++) target.push(next[i] as THREE.Vector3);
}

const EPS = 1e-9;

/** Draws a strategy for each corner and stitches the raw arcs into final spans accordingly. */
function stitchPath(
  raw: RawSpans,
  weights: CornerWeights,
  loopRadius: number,
  draw: () => number,
): THREE.Vector3[][] {
  const { arcs, corners } = raw;
  if (corners.length === 0) return arcs;

  const closed = arcs.length === corners.length;
  const loopDiameter = loopRadius * 2;
  const decisions: CornerDecision[] = corners.map((c, k) => {
    const before = closed
      ? (arcs[(k - 1 + arcs.length) % arcs.length] as THREE.Vector3[])
      : (arcs[k] as THREE.Vector3[]);
    const after = closed ? (arcs[k] as THREE.Vector3[]) : (arcs[k + 1] as THREE.Vector3[]);
    const room = Math.min(polyLength(before), polyLength(after));
    return { ...c, strategy: pickStrategy(c.turn, room, loopDiameter, weights, draw) };
  });

  if (!closed) {
    const spans: THREE.Vector3[][] = [];
    let current = (arcs[0] as THREE.Vector3[]).slice();
    for (let k = 0; k < decisions.length; k++) {
      const decision = decisions[k] as CornerDecision;
      const next = arcs[k + 1] as THREE.Vector3[];
      if (decision.strategy === 'break') {
        spans.push(current);
        current = next.slice();
      } else {
        mergeArc(current, next, decision, loopRadius);
      }
    }
    spans.push(current);
    return spans;
  }

  const n = arcs.length;
  const breakIdx = decisions.findIndex((d) => d.strategy === 'break');

  if (breakIdx === -1) {
    // No break anywhere: the whole contour is one closed span.
    const current = (arcs[0] as THREE.Vector3[]).slice();
    for (let k = 1; k < n; k++) {
      mergeArc(current, arcs[k] as THREE.Vector3[], decisions[k] as CornerDecision, loopRadius);
    }
    const start = (arcs[0] as THREE.Vector3[])[0] as THREE.Vector3;
    const closing = decisions[0] as CornerDecision;
    if (closing.strategy === 'loop') {
      const cornerPt = current[current.length - 1] as THREE.Vector3;
      const before = current[current.length - 2];
      for (const p of buildLoop(cornerPt, tangentInto(cornerPt, before, undefined), loopRadius)) {
        current.push(p);
      }
    }
    if ((current[current.length - 1] as THREE.Vector3).distanceTo(start) > EPS) current.push(start);
    return [current];
  }

  // Rotate so the walk starts right after a break, reducing this to the open-path case.
  const spans: THREE.Vector3[][] = [];
  let current = (arcs[breakIdx] as THREE.Vector3[]).slice();
  for (let i = 1; i < n; i++) {
    const arcIdx = (breakIdx + i) % n;
    const decision = decisions[arcIdx] as CornerDecision;
    if (decision.strategy === 'break') {
      spans.push(current);
      current = (arcs[arcIdx] as THREE.Vector3[]).slice();
    } else {
      mergeArc(current, arcs[arcIdx] as THREE.Vector3[], decision, loopRadius);
    }
  }
  spans.push(current);
  return spans;
}

/**
 * Cuts `span` into `pieces` runs by arc length. A span needs at least 2 vertices per piece, so
 * a request beyond `span.length - 1` is capped rather than honored.
 */
function slice(span: THREE.Vector3[], pieces: number): THREE.Vector3[][] {
  const n = Math.min(Math.max(1, pieces), Math.max(1, span.length - 1));
  if (n <= 1) return [span];

  const total = polyLength(span);
  const out: THREE.Vector3[][] = [];
  let cur: THREE.Vector3[] = [span[0] as THREE.Vector3];
  let acc = 0;
  let next = 1;
  for (let i = 1; i < span.length; i++) {
    acc += (span[i] as THREE.Vector3).distanceTo(span[i - 1] as THREE.Vector3);
    cur.push(span[i] as THREE.Vector3);
    // Absolute target (next * total / n), not accumulate-and-reset: resetting acc to 0 after
    // each cut discards the previous piece's overshoot, and that loss compounds over many pieces.
    if (next < n && i < span.length - 1 && acc >= (next * total) / n) {
      out.push(cur);
      cur = [span[i] as THREE.Vector3];
      next++;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Corners are detected the same way regardless of strategy; `runs` inserts the rest of the cuts,
 * distributed across spans by length with largest remainder. The count is a request, not a
 * guarantee — it cannot go below the count of spans a corner's `break` draws produce, and the
 * floor can take the result lower still.
 */
export function cutIntoRuns(paths: GeneratedPath[], opts: CutOptions): Run[] {
  const weights = opts.corners ?? ALL_BREAK;
  const loopRadius = LOOP_RADIUS_FACTOR * (opts.radius ?? FALLBACK_RADIUS);
  const seed = opts.seed ?? 0;
  let cornerCounter = 0;
  const draw = () => rng(cornerSeed(seed, cornerCounter++))();

  const spans: { points: THREE.Vector3[]; surface: SurfaceKind }[] = [];
  for (const path of paths) {
    const raw = rawSpansOf(path, DEFAULT_CORNER);
    for (const points of stitchPath(raw, weights, loopRadius, draw)) {
      if (points.length > 1) spans.push({ points, surface: path.surface });
    }
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
