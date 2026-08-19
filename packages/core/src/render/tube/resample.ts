import type { Point2 } from './field.js';

const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(line: Point2[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += dist(line[i - 1] as Point2, line[i] as Point2);
  return total;
}

/** isoContours() output is always a closed loop; this is that loop's total edge length. */
function closedLength(line: Point2[]): number {
  let total = 0;
  for (let i = 0; i < line.length; i++) {
    total += dist(line[i] as Point2, line[(i + 1) % line.length] as Point2);
  }
  return total;
}

/**
 * Even arc-length spacing on a closed contour, so point count tracks length rather than how a
 * curve was authored. Point count is fixed by the input's own edge length, so it stays stable
 * across input resolutions. This walks the input polyline as-is: corners survive exactly, because
 * a later stage detects them to decide where tube runs split.
 */
export function resample(line: Point2[], spacing: number): Point2[] {
  if (line.length < 2) return line.slice();
  const n = Math.max(8, Math.round(closedLength(line) / spacing));

  const pts = line.concat([line[0] as Point2]);
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1] as Point2, pts[i] as Point2);
    seg.push(d);
    total += d;
  }
  const step = total / n;
  const out: Point2[] = [];
  let idx = 0;
  let walked = 0;

  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (idx < seg.length - 1 && walked + (seg[idx] as number) < target) {
      walked += seg[idx] as number;
      idx++;
    }
    const len = seg[idx] as number;
    const t = len > 0 ? (target - walked) / len : 0;
    const a = pts[idx] as Point2;
    const b = pts[idx + 1] as Point2;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/**
 * Three-tap smoothing; marching squares emits staircase noise at grid scale. `mode: 'closed'`
 * wraps around the loop; `'open'` holds both endpoints fixed instead of dragging them toward
 * each other, for a run that has already been cut at its corners.
 */
export function smooth(line: Point2[], passes: number, mode: 'open' | 'closed'): Point2[] {
  let cur = line;
  for (let p = 0; p < passes; p++) {
    cur = cur.map((_, i) => {
      const b = cur[i] as Point2;
      if (mode === 'open' && (i === 0 || i === cur.length - 1)) return b;
      const prevIdx = mode === 'closed' ? (i - 1 + cur.length) % cur.length : i - 1;
      const nextIdx = mode === 'closed' ? (i + 1) % cur.length : i + 1;
      const a = cur[prevIdx] as Point2;
      const c = cur[nextIdx] as Point2;
      return { x: a.x * 0.25 + b.x * 0.5 + c.x * 0.25, y: a.y * 0.25 + b.y * 0.5 + c.y * 0.25 };
    });
  }
  return cur;
}

/** Radius of the circle through each consecutive triple; the sweep pinches past this. */
export function minCurvatureRadius(line: Point2[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i + 1 < line.length; i++) {
    const A = line[i - 1] as Point2;
    const B = line[i] as Point2;
    const C = line[i + 1] as Point2;
    const a = dist(B, C);
    const b = dist(A, C);
    const c = dist(A, B);
    const area = Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y)) / 2;
    if (area < 1e-12) continue;
    min = Math.min(min, (a * b * c) / (4 * area));
  }
  return min;
}
