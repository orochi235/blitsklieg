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
  /** One step of the offset, small enough to stay on the solid side of any corner it starts at. */
  let probe: Point2 | null = null;
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
    probe ??= { x: cur.x - nx * level * 1e-3, y: cur.y - ny * level * 1e-3 };
  }
  if (!probe) return [];
  // A fold past the medial axis lands on the far side of the source ring, which the distance test
  // reads as clean because it is nowhere near it. Insetting deeper than a shape's own half-width
  // folds every point that way, and the ring has to vanish rather than come back inside out.
  const solid = inside(probe, ring);
  const onSolidSide = moved.filter((p) => inside(p, ring) === solid);
  if (onSolidSide.length < 3) return [];
  const keep = onSolidSide.filter((p) => distanceToRing(p, ring) > Math.abs(level) * 0.75);
  return keep.length >= 8 ? keep : onSolidSide;
}

/** Ray cast, counting crossings of the ring by a ray running +x from `p`. */
function inside(p: Point2, ring: Point2[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Point2;
    const b = ring[j] as Point2;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit;
    }
  }
  return hit;
}

/** Twice the signed area: positive for the winding a font gives an outer contour. */
function signedArea(ring: Point2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[i] as Point2;
    const q = ring[j] as Point2;
    a += (q.x + p.x) * (q.y - p.y);
  }
  return a / 2;
}

/**
 * Rings rewound so an outer contour is positive and a hole negative, which is what lets one
 * `level` multiplier inset both. A caller's own shapes need not follow the font's winding, and
 * under the direct source the wrong winding outsets silently instead of insetting.
 */
export function orientRings(polygons: Point2[][]): Point2[][] {
  return polygons.map((ring) => {
    let depth = 0;
    for (const other of polygons) {
      if (other !== ring && inside(ring[0] as Point2, other)) depth += 1;
    }
    const wantPositive = depth % 2 === 0;
    return signedArea(ring) > 0 === wantPositive ? ring : [...ring].reverse();
  });
}
