/**
 * Does each path source find the same contours, or a different letter?
 *
 *   npm run build -w klieg && node spikes/contour-parity.mjs [look]
 *
 * A source that drops or invents a contour is not a fidelity improvement. Reports contour count
 * and total path length per letter; the direct trace is the one at risk, since it neither resolves
 * overlapping contours nor survives an offset that collapses a thin feature.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const LOOK = process.argv[2] ?? 'tubing';
const spec = specOf(LOOK).decoration;
const SOURCES = ['field', 'exact', 'direct'];
const len = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += pts[i].distanceTo(pts[i - 1]); return s; };

console.log(`${LOOK} (level ${spec.level}) — front contours found per source\n`);
console.log('  ch   today        A exact      B direct     verdict');
let diffs = 0;
for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  const surfaces = surfacesOf(glyphToShapes(font, ch, 1), 0.3);
  const got = SOURCES.map((source) => {
    const paths = generatePaths(surfaces, ['front'], {
      level: spec.level, spacing: spec.spacing, wallDepth: 0.5, resolution: 256, pad: 0.35, source,
    });
    return { n: paths.length, L: paths.reduce((a, p) => a + len(p.points), 0) };
  });
  const [f, a, b] = got;
  const note = [];
  if (a.n !== f.n) note.push(`A ${a.n - f.n > 0 ? '+' : ''}${a.n - f.n} contours`);
  if (b.n !== f.n) note.push(`B ${b.n - f.n > 0 ? '+' : ''}${b.n - f.n} contours`);
  const dL = Math.abs(b.L - f.L) / f.L;
  if (dL > 0.03) note.push(`B length ${((b.L / f.L - 1) * 100).toFixed(0)}%`);
  if (note.length) diffs++;
  console.log(`  ${ch}    ${f.n} / ${f.L.toFixed(2)}   ${a.n} / ${a.L.toFixed(2)}   ${b.n} / ${b.L.toFixed(2)}   ${note.join(', ')}`);
}
console.log(`\n  ${diffs} of 26 letters differ`);
