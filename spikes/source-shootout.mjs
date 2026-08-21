/**
 * The three path sources measured against each other through the whole pipeline.
 *
 *   npm run build -w klieg && node spikes/source-shootout.mjs
 *
 * Same measure as `bend-acceptance.mjs` — buildTubeBlueprint, wander included, tightestBend per
 * run — with only `pathSource` varying, plus build time and the contour count each source finds.
 * A source that loses a contour is producing a different letter, not a better one, so the count
 * is reported next to the acceptance.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { minBendRadius } from '../packages/core/dist/render/tube/bend.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { tightestBend } from '../packages/core/dist/render/tube/sweep.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SOURCES = ['field', 'exact', 'direct'];
const LABEL = { field: 'today (field)', exact: 'A exact field', direct: 'B direct trace' };

const CASES = [
  ['tubing', specOf('tubing').decoration],
  ['tubing no wander', { ...specOf('tubing').decoration, amplitude: 0 }],
  ['piping', specOf('piping').decoration],
  ['piping no wander', { ...specOf('piping').decoration, amplitude: 0 }],
];
for (const [look, base] of CASES) {
  const rhoMin = minBendRadius(base.radius, base.bend);
  const tol = rhoMin * 1e-6;
  console.log(`\n${look}  rho_min ${rhoMin.toFixed(4)}, radius ${base.radius}, level ${base.level}`);
  for (const source of SOURCES) {
    const spec = { ...base, pathSource: source };
    let under = 0, total = 0, ms = 0, worst = Infinity, worstAt = '';
    const perLetter = [];
    for (const ch of LETTERS) {
      const t = process.hrtime.bigint();
      const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), spec, 0.3, 0);
      ms += Number(process.hrtime.bigint() - t) / 1e6;
      let letterUnder = 0;
      for (const run of bp.runs) {
        const bend = tightestBend(run);
        total += 1;
        if (bend < rhoMin - tol) { under += 1; letterUnder += 1; }
        if (bend < worst) { worst = bend; worstAt = `${ch} run ${run.index}`; }
      }
      perLetter.push(letterUnder ? `${ch}:${letterUnder}` : null);
      bp.dispose();
      process.stdout.write(`    ${LABEL[source]} ... ${ch}\n`);
    }
    const bad = perLetter.filter(Boolean).join(' ');
    console.log(`  ${LABEL[source].padEnd(15)} ${String(under).padStart(3)}/${String(total).padStart(3)} under rho_min` +
      `   worst ${(worst / base.radius).toFixed(2)}r at ${worstAt.padEnd(10)}   ${ms.toFixed(0)}ms` +
      (bad ? `   [${bad}]` : ''));
  }
}
