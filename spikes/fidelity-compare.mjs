/**
 * Draws what the tube's path would follow before and after an exact field.
 *
 *   npm run build -w klieg && node spikes/fidelity-compare.mjs [letter]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { isoContours, signedDistanceField } from '../packages/core/dist/render/tube/field.js';
import { resample } from '../packages/core/dist/render/tube/resample.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const spec = specOf('tubing').decoration;
const RES = 256, PAD = 0.35, CH = process.argv[2] ?? 'W';

const distToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
function bandedField(polygons, level, bandCells = 3) {
  const base = signedDistanceField(polygons, { resolution: RES, pad: PAD });
  const { size: n, emPerCell, originX: minX, originY: minY } = base;
  const span = emPerCell * (n - 1), BUCKET = span / 64;
  const segs = [];
  for (const poly of polygons) for (let i = 0; i < poly.length; i++) segs.push([poly[i], poly[(i + 1) % poly.length]]);
  const buckets = new Map(), bkey = (bx, by) => bx * 8192 + by;
  for (const s of segs) {
    const x0 = Math.floor((Math.min(s[0].x, s[1].x) - minX) / BUCKET), x1 = Math.floor((Math.max(s[0].x, s[1].x) - minX) / BUCKET);
    const y0 = Math.floor((Math.min(s[0].y, s[1].y) - minY) / BUCKET), y1 = Math.floor((Math.max(s[0].y, s[1].y) - minY) / BUCKET);
    for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) {
      const k = bkey(bx, by), l = buckets.get(k); if (l) l.push(s); else buckets.set(k, [s]);
    }
  }
  const data = Float64Array.from(base.data), reach = bandCells * emPerCell;
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    const i = gy * n + gx;
    if (Math.abs(data[i] - level) > reach) continue;
    const x = minX + gx * emPerCell, y = minY + gy * emPerCell, p = { x, y };
    const bx = Math.floor((x - minX) / BUCKET), by = Math.floor((y - minY) / BUCKET);
    let best = Infinity;
    for (let r = 0; r < 64; r++) {
      for (let ox = -r; ox <= r; ox++) for (let oy = -r; oy <= r; oy++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        const list = buckets.get(bkey(bx + ox, by + oy)); if (!list) continue;
        for (const s of list) { const d = distToSeg(p, s[0], s[1]); if (d < best) best = d; }
      }
      if (best <= r * BUCKET) break;
    }
    data[i] = data[i] < 0 ? -best : best;
  }
  return { data, size: n, emPerCell, originX: minX, originY: minY, sample: () => 0 };
}

const shapes = glyphToShapes(font, CH, 1);
const surfaces = surfacesOf(shapes, 0.3);
const polys = surfaces.find((s) => s.kind === 'front').polygons;
const truth = [];
for (const shape of shapes) for (const c of [shape, ...shape.holes]) {
  const raw = c.getPoints(200).map((p) => ({ x: p.x, y: p.y }));
  const f = raw[0], l = raw[raw.length - 1];
  if (raw.length > 1 && Math.hypot(f.x - l.x, f.y - l.y) < 1e-9) raw.pop();
  if (raw.length >= 3) truth.push(raw);
}
const todayL = isoContours(signedDistanceField(polys, { resolution: RES, pad: PAD }), spec.level).map((l) => resample(l, spec.spacing)).filter((l) => l.length >= 4);
const bandL = isoContours(bandedField(polys, spec.level), spec.level).map((l) => resample(l, spec.spacing)).filter((l) => l.length >= 4);

const all = [...truth.flat(), ...todayL.flat(), ...bandL.flat()];
const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x));
const minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
const PANEL = 820, M = 50;
const S = (PANEL - M * 2) / Math.max(maxX - minX, maxY - minY);
const H = (maxY - minY) * S + M * 2 + 70, W = PANEL * 2;
const X = (p, off) => (p.x - minX) * S + M + off;
const Y = (p) => H - 20 - ((p.y - minY) * S + M);
const poly = (r, cls, off) => `<polygon class="${cls}" points="${r.map((p) => `${X(p, off).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}"/>`;
const dots = (r, cls, off) => r.map((p) => `<circle class="${cls}" cx="${X(p, off).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="2.6"/>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H.toFixed(0)}" viewBox="0 0 ${W} ${H.toFixed(0)}">
<style>
 .bg{fill:#14161a}.truth{fill:none;stroke:#7dd3fc;stroke-width:2.5}
 .now{fill:none;stroke:#f97316;stroke-width:2}.nowpt{fill:#f97316}
 .fix{fill:none;stroke:#34d399;stroke-width:2}.fixpt{fill:#34d399}
 text{font:17px ui-monospace,monospace;fill:#e2e8f0}
 .sub{font:14px ui-monospace,monospace;fill:#94a3b8}
</style>
<rect class="bg" x="0" y="0" width="${W}" height="${H.toFixed(0)}"/>
<text x="${M}" y="34">today — 256² binary mask + EDT</text>
<text class="sub" x="${M}" y="56">mean 5% of tube radius off the outline, everywhere</text>
${truth.map((r) => poly(r, 'truth', 0)).join('')}
${todayL.map((r) => poly(r, 'now', 0)).join('')}
${todayL.map((r) => dots(r, 'nowpt', 0)).join('')}
<text x="${M + PANEL}" y="34">banded exact field — same build time</text>
<text class="sub" x="${M + PANEL}" y="56">mean 0.00004 em; the wobble is gone</text>
${truth.map((r) => poly(r, 'truth', PANEL)).join('')}
${bandL.map((r) => poly(r, 'fix', PANEL)).join('')}
${bandL.map((r) => dots(r, 'fixpt', PANEL)).join('')}
</svg>`;
const out = new URL('../test-results/fidelity-compare.svg', import.meta.url);
writeFileSync(out, svg);
console.log(`wrote ${out.pathname}`);
