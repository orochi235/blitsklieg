/**
 * How a path source changes the run decomposition, not just the path.
 *
 *   npm run build -w blitsklieg && node spikes/run-decomposition.mjs [look] [letters]
 *
 * Prints each source's runs, their lengths, and the lit/dark pattern `assign` paints from one seed.
 * The paths agree to about 0.001 em, but the grid's wobble manufactures corners and every corner is
 * a candidate break, so the cut lands elsewhere and the same seed paints a different letter. That,
 * not fidelity, is what makes the two look different side by side.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';
const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const base = specOf(process.argv[2] ?? 'tubing').decoration;
for (const ch of process.argv[3] ?? 'MWSB') {
  console.log(`\n  ${ch}`);
  for (const source of ['field', 'exact', 'direct']) {
    const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), { ...base, pathSource: source }, 0.3, 0);
    const pattern = bp.runs.map((r) => (r.dark ? 'x' : r.lit ? 'O' : '.')).join('');
    const lens = bp.runs.map((r) => r.length.toFixed(2)).join(' ');
    const cols = [...new Set(bp.runs.filter((r) => r.lit).map((r) => r.color.toString(16)))].join(',');
    console.log(`    ${source.padEnd(7)} ${String(bp.runs.length).padStart(2)} runs  lit ${pattern}`);
    console.log(`            lengths ${lens}`);
    console.log(`            colors  ${cols}`);
    bp.dispose();
  }
}
