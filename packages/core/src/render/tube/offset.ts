import type { Point2 } from './field.js';

export function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distanceToRing(p: Point2, ring: Point2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const d = distanceToSegment(p, ring[i] as Point2, ring[(i + 1) % ring.length] as Point2);
    if (d < best) best = d;
  }
  return best;
}

/**
 * A closed ring moved `level` along its vertex normals — negative insets, matching the isocontour
 * level it replaces. The normal is the tangent turned a quarter, which points into the solid for an
 * outer contour and out of the counter for a hole, so one multiplier serves both; deriving the
 * direction from winding instead insets counters backwards by a full `level`, silently and with no
 * change in contour count. A normal offset folds wherever the offset exceeds the local radius of
 * curvature, so folded points — the ones that land nearer the source ring than the offset they were
 * moved by — are dropped rather than left to loop the path.
 */
export function offsetRing(ring: Point2[], level: number): Point2[] {
  if (level === 0 || ring.length < 3) return ring;
  const n = ring.length;
  const moved: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n] as Point2;
    const cur = ring[i] as Point2;
    const next = ring[(i + 1) % n] as Point2;
    let nx = next.y - prev.y;
    let ny = -(next.x - prev.x);
    const len = Math.hypot(nx, ny);
    if (len < 1e-12) continue;
    nx /= len;
    ny /= len;
    moved.push({ x: cur.x - nx * level, y: cur.y - ny * level });
  }
  const keep = moved.filter((p) => distanceToRing(p, ring) > Math.abs(level) * 0.75);
  return keep.length >= 8 ? keep : moved;
}
