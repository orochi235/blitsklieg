/**
 * What each path source does with two overlapping contours — an unmerged multi-component glyph.
 *
 *   npm run build -w blitsklieg && node spikes/contour-overlap.mjs
 *
 * blitsklieg takes whatever font a caller supplies, so overlapping contours are a real input. The
 * grid sources rasterise even-odd, which merges the silhouette but turns the overlap itself into a
 * hole; the direct trace emits both rings and lets the tube cross itself. Neither is the non-zero
 * winding a font means, and they differ, so this is a behaviour change and not a detail.
 */
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
const dense = (ring, step = 0.01) => {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
};
// Two squares sharing a large overlap — an unmerged two-component glyph, common in real fonts.
const polygons = [dense(sq(0, 0, 0.4)), dense(sq(0.25, 0.1, 0.4))];
const surfaces = [{ kind: 'front', z: 0.3, polygons }];
for (const source of ['field', 'exact', 'direct']) {
  const paths = generatePaths(surfaces, ['front'], {
    level: 0, spacing: 0.02, wallDepth: 0.5, resolution: 256, pad: 0.35, source,
  });
  const lens = paths.map((p) => {
    let s = 0;
    for (let i = 1; i < p.points.length; i++) s += p.points[i].distanceTo(p.points[i - 1]);
    return s.toFixed(2);
  });
  console.log(`  ${source.padEnd(7)} ${paths.length} contour(s), lengths [${lens.join(', ')}]`);
}
console.log('\n  the merged silhouette of the two squares has one contour of perimeter ~2.05;');
console.log('  two separate squares are two contours of 1.60 each.');
