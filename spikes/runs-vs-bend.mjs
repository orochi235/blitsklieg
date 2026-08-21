/**
 * Why the `runs` slider does more at some `bend` values than others.
 *
 *   npm run build -w klieg && node spikes/runs-vs-bend.mjs [look] [letter]
 *
 * `runs` is a request bounded below by the corner count: a corner that breaks is a cut, and a cut is
 * a run whether one was asked for or not. `bend` sets the fillet setback, so it sets how often a
 * fillet is rejected and the corner breaks instead — which moves the floor `runs` is pushing
 * against. The table is that floor.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const base = specOf(process.argv[2] ?? 'tubing').decoration;
const CH = process.argv[3] ?? 'S';
const BENDS = [1.25, 1.5, 2, 2.5, 3, 4];
const RUNS = [1, 2, 4, 6, 8, 12, 16, 24];

console.log(`${process.argv[2] ?? 'tubing'} '${CH}': actual run count for each (bend, runs) pair\n`);
console.log(`  bend \\ runs  ${RUNS.map((r) => String(r).padStart(4)).join('')}     floor   breaks`);
for (const bend of BENDS) {
  const row = [];
  let floor = Infinity;
  let breaks = 0;
  for (const runs of RUNS) {
    const bp = buildTubeBlueprint(glyphToShapes(font, CH, 1), { ...base, bend, runs }, 0.3, 0);
    row.push(bp.runs.length);
    floor = Math.min(floor, bp.runs.length);
    if (runs === RUNS[0]) breaks = bp.corners.filter((c) => c.strategy === 'break').length;
    bp.dispose();
  }
  const flat = row.filter((v) => v === floor).length;
  console.log(
    `  ${String(bend).padEnd(11)}  ${row.map((v) => String(v).padStart(4)).join('')}` +
      `     ${String(floor).padStart(3)}     ${String(breaks).padStart(3)}` +
      `   ${flat} of ${RUNS.length} slider positions pinned`,
  );
}
