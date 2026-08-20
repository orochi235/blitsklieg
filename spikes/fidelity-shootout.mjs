/**
 * Today's field vs an exact field (A) vs a direct contour trace (B), through the whole tube
 * pipeline and drawn as the tube itself.
 *
 *   npm run build -w blitsklieg && node spikes/fidelity-shootout.mjs [look] [letters]
 *
 * Each column runs the same cut, wander and sweep; only the path source differs. Runs are stroked
 * at the tube's own diameter, so what is drawn is the tube's silhouette on the front plane rather
 * than a centerline. Unlit runs are drawn dark, as the look renders them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { cutIntoRuns } from '../packages/core/dist/render/tube/runs.js';
import { assign } from '../packages/core/dist/render/tube/assign.js';
import { smoothedPoints } from '../packages/core/dist/render/tube/sweep.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { minBendRadius, vertexBends } from '../packages/core/dist/render/tube/bend.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const LOOK = process.argv[2] ?? 'tubing';
const LETTERS = process.argv[3] ?? 'MWSB';
const spec = specOf(LOOK).decoration;
if (spec.kind !== 'tube') throw new Error(`${LOOK} is not a tube look`);
const rhoMin = minBendRadius(spec.radius, spec.bend);
const DEPTH = 0.3, RES = 256, PAD = 0.35, SEED = 7;
const opts = { level: spec.level, spacing: spec.spacing, wallDepth: 0.5, wallRise: spec.wallRise, resolution: RES, pad: PAD };

const METHODS = [
  ['today', (s) => generatePaths(s, ['front'], { ...opts, source: 'field' })],
  ['A exact field', (s) => generatePaths(s, ['front'], { ...opts, source: 'exact' })],
  ['B direct trace', (s) => generatePaths(s, ['front'], { ...opts, source: 'direct' })],
];

/** Full pipeline downstream of the path source, so only the source varies. */
function runsFor(shapes, make) {
  const surfaces = surfacesOf(shapes, DEPTH);
  const paths = make(surfaces);
  const cut = cutIntoRuns(paths, {
    runs: spec.runs, minRun: spec.minRun, corners: spec.corners,
    spacing: spec.spacing, bend: spec.bend, radius: spec.radius, blockout: spec.blockout, seed: SEED,
  });
  return { runs: assign(cut.runs, spec.select, spec.colors, SEED), corners: cut.corners };
}

const cells = [];
let n = 0;
for (const ch of LETTERS) {
  const shapes = glyphToShapes(font, ch, 1);
  for (const [name, make] of METHODS) {
    const t = process.hrtime.bigint();
    const { runs, corners } = runsFor(shapes, make);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    let under = 0, verts = 0;
    for (const run of runs) {
      const pts = smoothedPoints(run);
      verts += pts.length;
      under += vertexBends(pts, false).filter((b) => b.rho < rhoMin * 0.999).length;
    }
    cells.push({ ch, name, runs, ms, under, verts, corners: corners.length });
    n++;
    console.log(`  ${String(n).padStart(2)}/${LETTERS.length * METHODS.length}  ${ch} ${name.padEnd(15)} ` +
      `${runs.length} runs, ${verts} vertices, ${corners.length} corners, ${under} under rho_min, ${ms.toFixed(0)}ms`);
  }
}

// --- draw ----------------------------------------------------------------------------
const all = cells.flatMap((c) => c.runs.flatMap((r) => smoothedPoints(r)));
const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x));
const minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
const CW = 460, CH_ = 520, M = 46, HEAD = 64;
const S = Math.min((CW - M * 2) / (maxX - minX), (CH_ - M * 2 - 40) / (maxY - minY));
const W = CW * METHODS.length, H = HEAD + CH_ * LETTERS.length;

const parts = [];
parts.push(`<rect class="bg" x="0" y="0" width="${W}" height="${H}"/>`);
METHODS.forEach(([name], i) => {
  parts.push(`<text class="hd" x="${i * CW + M}" y="40">${name}</text>`);
});
cells.forEach((c) => {
  const col = METHODS.findIndex(([n2]) => n2 === c.name);
  const row = LETTERS.indexOf(c.ch);
  const ox = col * CW + M, oy = HEAD + row * CH_ + M;
  const X = (p) => ox + (p.x - minX) * S;
  const Y = (p) => oy + (maxY - p.y) * S;
  for (const run of c.runs) {
    const pts = smoothedPoints(run);
    if (pts.length < 2) continue;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)} ${Y(p).toFixed(1)}`).join(' ');
    const col2 = run.lit ? `#${(run.color >>> 0).toString(16).padStart(6, '0')}` : '#3b4252';
    parts.push(`<path d="${d}" fill="none" stroke="${col2}" stroke-width="${(spec.radius * 2 * S).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="${run.lit ? 0.95 : 0.8}"/>`);
  }
  parts.push(`<text class="cap" x="${ox}" y="${oy + (maxY - minY) * S + 26}">${c.runs.length} runs · ${c.corners} corners · ${c.under} under ρmin · ${c.ms.toFixed(0)}ms</text>`);
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
 .bg{fill:#0d0f13}
 .hd{font:22px ui-monospace,monospace;fill:#e2e8f0}
 .cap{font:13px ui-monospace,monospace;fill:#8b96a5}
</style>
${parts.join('\n')}
</svg>`;
const out = new URL(`../test-results/shootout-${LOOK}.svg`, import.meta.url);
writeFileSync(out, svg);
console.log(`\nwrote ${out.pathname}`);
