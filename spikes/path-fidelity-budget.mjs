/**
 * Where does the tube's path actually lose the font's shape?
 *
 *   npm run build -w blitsklieg && node spikes/path-fidelity-budget.mjs [letters]
 *
 * The pipeline goes: bezier -> getPoints(24) -> resample(0.01) -> 256^2 binary mask -> EDT ->
 * marching squares -> resample(spacing). Each stage is measured against a densely-sampled bezier
 * reference, so the round trip's share of the error is separated from the flattening that precedes
 * it. Writes an SVG overlay of the worst letter next to the numbers.
 */
import { writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { resample } from '../packages/core/dist/render/tube/resample.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';
import { readFileSync } from 'node:fs';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const spec = specOf('tubing').decoration;

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function distToRings(p, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const d = distToSeg(p, ring[i], ring[(i + 1) % ring.length]);
      if (d < best) best = d;
    }
  }
  return best;
}
const stats = (ds) => {
  const s = [...ds].sort((a, b) => a - b);
  return {
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    p95: s[Math.floor(s.length * 0.95)],
    max: s[s.length - 1],
  };
};

/** Dense bezier sampling: the shape as the font authored it, for all practical purposes. */
function truthRings(shapes) {
  const out = [];
  for (const shape of shapes) {
    for (const contour of [shape, ...shape.holes]) {
      const raw = contour.getPoints(200).map((p) => ({ x: p.x, y: p.y }));
      const f = raw[0], l = raw[raw.length - 1];
      if (raw.length > 1 && Math.hypot(f.x - l.x, f.y - l.y) < 1e-9) raw.pop();
      if (raw.length >= 3) out.push(raw);
    }
  }
  return out;
}

const LETTERS = process.argv[2] ?? 'MWNSRE';
const pct = (d) => `${((d / spec.radius) * 100).toFixed(0)}%`;
const row = (label, s) =>
  `    ${label.padEnd(34)} mean ${s.mean.toFixed(5)} (${pct(s.mean).padStart(4)})   ` +
  `p95 ${s.p95.toFixed(5)}   max ${s.max.toFixed(5)} (${pct(s.max).padStart(4)})`;

console.log(
  `tubing: tube radius ${spec.radius} em, level ${spec.level}. Error measured against a\n` +
    `densely-sampled bezier, quoted in em and as a fraction of the tube radius.\n`,
);

let worstCh = null, worstMax = -1, worstData = null;
for (const ch of LETTERS) {
  const shapes = glyphToShapes(font, ch, 1);
  const truth = truthRings(shapes);
  const surfaces = surfacesOf(shapes, 0.3);
  const rings = surfaces.filter((s) => s.kind === 'wall').map((w) => w.ring);
  const fieldPaths = generatePaths(surfaces, ['front'], {
    level: spec.level, spacing: spec.spacing, wallDepth: 0.5, resolution: 256, pad: 0.35,
  });
  const direct = rings.map((r) => resample(r, spec.spacing));

  const dFlat = rings.flatMap((r) => r.map((p) => distToRings(p, truth)));
  const dDirect = direct.flatMap((r) => r.map((p) => distToRings(p, truth)));
  const dField = fieldPaths.flatMap((p) => p.points.map((q) => distToRings(q, truth)));

  const sFlat = stats(dFlat), sDirect = stats(dDirect), sField = stats(dField);
  console.log(`  ${ch}`);
  console.log(row('flatten getPoints(24)+resample .01', sFlat));
  console.log(row('  + resample to spacing (direct)', sDirect));
  console.log(row('  + 256^2 field round trip (today)', sField));
  if (sField.max > worstMax) {
    worstMax = sField.max; worstCh = ch;
    worstData = { truth, direct, field: fieldPaths.map((p) => p.points) };
  }
}

// --- SVG overlay of the worst letter -------------------------------------------------
const { truth, direct, field } = worstData;
const all = [...truth.flat(), ...direct.flat(), ...field.flat()];
const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x));
const minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
const S = 900 / Math.max(maxX - minX, maxY - minY);
const M = 60;
const W = (maxX - minX) * S + M * 2, H = (maxY - minY) * S + M * 2;
const X = (p) => (p.x - minX) * S + M;
const Y = (p) => H - ((p.y - minY) * S + M);
const poly = (ring, cls) =>
  `<polygon class="${cls}" points="${ring.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}"/>`;
const dots = (ring, cls) =>
  ring.map((p) => `<circle class="${cls}" cx="${X(p).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="3"/>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}">
<style>
  .bg { fill: #14161a; }
  .truth { fill: none; stroke: #7dd3fc; stroke-width: 2; }
  .field { fill: none; stroke: #f97316; stroke-width: 2; }
  .fieldpt { fill: #f97316; }
  .directpt { fill: #34d399; }
  text { font: 15px ui-monospace, monospace; fill: #cbd5e1; }
  .k1 { fill: #7dd3fc; } .k2 { fill: #f97316; } .k3 { fill: #34d399; }
</style>
<rect class="bg" x="0" y="0" width="${W.toFixed(0)}" height="${H.toFixed(0)}"/>
${truth.map((r) => poly(r, 'truth')).join('\n')}
${field.map((r) => poly(r, 'field')).join('\n')}
${field.map((r) => dots(r, 'fieldpt')).join('\n')}
<text x="20" y="26">'${worstCh}'  tube radius ${spec.radius} em -- worst field deviation ${worstMax.toFixed(5)} em (${pct(worstMax)} of radius)</text>
<text class="k1" x="20" y="48">font bezier (dense)</text>
<text class="k2" x="200" y="48">field contour + its vertices (what the tube follows today)</text>
</svg>`;
const out = new URL('../test-results/path-fidelity.svg', import.meta.url);
writeFileSync(out, svg);
console.log(`\n  wrote ${out.pathname}`);
