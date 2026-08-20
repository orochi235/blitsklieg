import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';
const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const spec = specOf('tubing').decoration;
for (const ch of 'JACKPOT') {
  const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), spec, 0.3, 0);
  const dark = bp.runs.filter((r) => r.dark);
  const lit = bp.runs.filter((r) => r.lit);
  console.log(`  ${ch}  ${bp.runs.length} runs, ${dark.length} dark (mean ${(dark.reduce((a,r)=>a+r.length,0)/Math.max(1,dark.length)).toFixed(3)} em), ${lit.length} lit`);
  bp.dispose();
}
