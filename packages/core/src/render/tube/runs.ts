import * as THREE from 'three';
import {
  type Corner,
  cornersByBend,
  type Fillet,
  filletAt,
  minBendRadius,
  STYLE_FACTOR,
} from './bend.js';
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

/** What one corner's strategy draw decided, in the path's own coordinates. */
export interface CornerRecord {
  point: THREE.Vector3;
  strategy: CornerStrategy;
  /** Turn angle in radians, the same measure `pickStrategy` biases on. */
  turn: number;
}

export interface CutResult {
  runs: Run[];
  /** Corner points alias the input paths' own vectors; copy before anything mutates a run. */
  corners: CornerRecord[];
}

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
  /** Minimum bend radius as a multiple of `radius`. Floored at 1.25. */
  bend?: number;
  /** Arc length between resampled path points, in em. A fillet's arc is sampled at this. */
  spacing?: number;
  /** Seeds the per-corner strategy draw so a word builds identically twice. */
  seed?: number;
}

/** Loop radius as a multiple of the requested tube radius. sweepRadius's 0.8 curvature
 *  clearance needs >= 1.25x to preserve full radius through a loop; this sits well clear of it. */
const LOOP_RADIUS_FACTOR = 4;
const LOOP_SEGMENTS = 28;
/** A weight factor never fully zeroes an option biasing can't rule out entirely. */
const FLOOR = 0.05;
/** Turn past which glass is treated as unable to bend without kinking. */
const CONNECT_LIMIT = Math.PI * 0.75;
const FALLBACK_RADIUS = 0.03;
const FALLBACK_SPACING = 0.02;

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

interface CornerDecision extends Corner {
  strategy: CornerStrategy;
  /** How far back along each leg a fillet here would cut, when one is drawn. */
  setback: number;
  /**
   * Where the drawn path actually passes, once a fillet has cut the corner vertex away. Aliases a
   * point of the run, so wander carries it, and the lab's markers stay on the tube.
   */
  at?: THREE.Vector3;
  /** The fillet decided for this corner, measured off the untouched legs. */
  fillet?: Fillet | null;
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
  corners: Corner[];
}

function rawSpansOf(path: GeneratedPath, rhoMin: number, rhoStyle: number): RawSpans {
  const { points, closed } = path;
  const corners = cornersByBend(points, closed, rhoMin, rhoStyle);

  if (corners.length === 0) {
    const whole = closed ? [...points, points[0] as THREE.Vector3] : points.slice();
    return { arcs: [whole], corners: [] };
  }

  if (closed) {
    const arcs: THREE.Vector3[][] = [];
    for (let k = 0; k < corners.length; k++) {
      const start = corners[k] as Corner;
      const end = corners[(k + 1) % corners.length] as Corner;
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

/**
 * Drops the tail of `span` back past the fillet's tangent point. Measured from the corner rather
 * than accumulated step by step: leaving a point *inside* the setback makes the path run forward to
 * it and then jump back to the tangent point, and that reversal reads as a tighter bend than the
 * corner it replaced.
 */
function trimTail(span: THREE.Vector3[], back: number): void {
  const corner = (span[span.length - 1] as THREE.Vector3).clone();
  while (span.length > 2 && (span[span.length - 1] as THREE.Vector3).distanceTo(corner) < back) {
    span.pop();
  }
}

/** The index in `span` at or past `skip` of arc length from its start. */
function indexPast(span: THREE.Vector3[], skip: number): number {
  let along = 0;
  for (let i = 1; i < span.length; i++) {
    along += (span[i] as THREE.Vector3).distanceTo(span[i - 1] as THREE.Vector3);
    if (along >= skip) return i;
  }
  return span.length - 1;
}

/**
 * The fillet for the join between `target` and `next`, or null when there is no room for one.
 * Probes with a synthetic three-point path whose legs are the arc length actually available either
 * side: the room test is against the leg, not against one 0.02 sample step, which every setback
 * would exceed.
 */
function filletFor(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  rhoMin: number,
  spacing: number,
): Fillet | null {
  const corner = target[target.length - 1] as THREE.Vector3 | undefined;
  const before = target[target.length - 2] as THREE.Vector3 | undefined;
  const after = next[1] as THREE.Vector3 | undefined;
  if (!corner || !before || !after) return null;

  const u = corner.clone().sub(before);
  const v = after.clone().sub(corner);
  if (u.lengthSq() < 1e-18 || v.lengthSq() < 1e-18) return null;
  u.normalize();
  v.normalize();

  const probe = [
    corner.clone().addScaledVector(u, -polyLength(target)),
    corner.clone(),
    corner.clone().addScaledVector(v, polyLength(next)),
  ];
  return filletAt(probe, false, 1, rhoMin, spacing);
}

/** Appends `next` onto `target`, which already ends at the shared corner; splices a loop first. */
function mergeArc(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  decision: CornerDecision,
  loopRadius: number,
  fillet: Fillet | null,
): void {
  if (decision.strategy === 'loop') {
    const cornerPt = target[target.length - 1] as THREE.Vector3;
    const before = target[target.length - 2];
    const tangentIn = tangentInto(cornerPt, before, next[1]);
    for (const p of buildLoop(cornerPt, tangentIn, loopRadius)) target.push(p);
    for (let i = 1; i < next.length; i++) target.push(next[i] as THREE.Vector3);
    return;
  }
  if (fillet) {
    trimTail(target, fillet.setback);
    decision.at = fillet.points[fillet.points.length >> 1];
    for (const p of fillet.points) target.push(p);
    for (let i = indexPast(next, fillet.setback); i < next.length; i++) {
      target.push(next[i] as THREE.Vector3);
    }
    return;
  }
  for (let i = 1; i < next.length; i++) target.push(next[i] as THREE.Vector3);
}

const EPS = 1e-9;

/** Draws a strategy for each corner and stitches the raw arcs into final spans accordingly. */
function stitchPath(
  raw: RawSpans,
  weights: CornerWeights,
  loopRadius: number,
  rhoMin: number,
  spacing: number,
  draw: () => number,
): { spans: THREE.Vector3[][]; decisions: CornerDecision[] } {
  const { arcs, corners } = raw;
  if (corners.length === 0) return { spans: arcs, decisions: [] };

  const closed = arcs.length === corners.length;
  const loopDiameter = loopRadius * 2;
  // `before` ends at the corner and `after` starts there, in both the open and closed layouts.
  const legsOf = (k: number) => ({
    before: closed
      ? (arcs[(k - 1 + arcs.length) % arcs.length] as THREE.Vector3[])
      : (arcs[k] as THREE.Vector3[]),
    after: closed ? (arcs[k] as THREE.Vector3[]) : (arcs[k + 1] as THREE.Vector3[]),
  });

  const decisions: CornerDecision[] = corners.map((c, k) => {
    const { before, after } = legsOf(k);
    const room = Math.min(polyLength(before), polyLength(after));
    const strategy = pickStrategy(c.turn, room, loopDiameter, weights, draw);
    // A hard corner drawn `connect` must fillet, and a fillet that will not fit breaks instead.
    // `CONNECT_LIMIT` used to guess this from the angle; now it is measured.
    const fillet =
      strategy === 'connect' && c.hard ? filletFor(before, after, rhoMin, spacing) : null;
    if (strategy === 'connect' && c.hard && !fillet) {
      return { ...c, strategy: 'break' as const, setback: 0 };
    }
    return { ...c, strategy, setback: fillet?.setback ?? 0, fillet };
  });

  // Both ends of a leg may fillet, and then the two setbacks have to fit in it together. The
  // deeper cut yields, since breaking the shallower one would remove less of the problem.
  for (let k = 0; k < corners.length; k++) {
    const here = decisions[k] as CornerDecision;
    const next = decisions[(k + 1) % decisions.length] as CornerDecision | undefined;
    if (!next || here.setback === 0 || next.setback === 0) continue;
    const leg = polyLength(legsOf(k).after);
    if (here.setback + next.setback <= leg) continue;
    const loser = here.setback >= next.setback ? here : next;
    loser.strategy = 'break';
    loser.setback = 0;
  }

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
        mergeArc(current, next, decision, loopRadius, decision.fillet ?? null);
      }
    }
    spans.push(current);
    return { spans, decisions };
  }

  const n = arcs.length;
  const breakIdx = decisions.findIndex((d) => d.strategy === 'break');

  if (breakIdx === -1) {
    // No break anywhere: the whole contour is one closed span.
    const current = (arcs[0] as THREE.Vector3[]).slice();
    for (let k = 1; k < n; k++) {
      mergeArc(
        current,
        arcs[k] as THREE.Vector3[],
        decisions[k] as CornerDecision,
        loopRadius,
        decisions[k]?.setback
          ? filletFor(current, arcs[k] as THREE.Vector3[], rhoMin, spacing)
          : null,
      );
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
    return { spans: [current], decisions };
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
      mergeArc(
        current,
        arcs[arcIdx] as THREE.Vector3[],
        decision,
        loopRadius,
        decision.setback > 0
          ? filletFor(current, arcs[arcIdx] as THREE.Vector3[], rhoMin, spacing)
          : null,
      );
    }
  }
  spans.push(current);
  return { spans, decisions };
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
export function cutIntoRuns(paths: GeneratedPath[], opts: CutOptions): CutResult {
  const weights = opts.corners ?? ALL_BREAK;
  const radius = opts.radius ?? FALLBACK_RADIUS;
  const rhoMin = minBendRadius(radius, opts.bend);
  const rhoStyle = radius * STYLE_FACTOR;
  const spacing = opts.spacing ?? FALLBACK_SPACING;
  const loopRadius = LOOP_RADIUS_FACTOR * radius;
  const seed = opts.seed ?? 0;
  let cornerCounter = 0;
  const draw = () => rng(cornerSeed(seed, cornerCounter++))();

  const cornerRecords: CornerRecord[] = [];
  const spans: { points: THREE.Vector3[]; surface: SurfaceKind }[] = [];
  for (const path of paths) {
    const raw = rawSpansOf(path, rhoMin, rhoStyle);
    const { spans: stitched, decisions } = stitchPath(
      raw,
      weights,
      loopRadius,
      rhoMin,
      spacing,
      draw,
    );
    for (const d of decisions) {
      cornerRecords.push({
        point: d.at ?? (path.points[d.index] as THREE.Vector3),
        strategy: d.strategy,
        turn: d.turn,
      });
    }
    for (const pts of stitched) {
      if (pts.length > 1) spans.push({ points: pts, surface: path.surface });
    }
  }
  if (spans.length === 0) return { runs: [], corners: cornerRecords };

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
  return { runs: out, corners: cornerRecords };
}
