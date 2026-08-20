/**
 * How much depth wander survives the bend invariant?
 *
 *   npm run build -w blitsklieg && node spikes/wander-cap.mjs
 *
 * Wander bends a run in z while its path bends in x/y, so the two are perpendicular and a point
 * already bending at rho_min has nothing left to spend. Every fillet sits at exactly rho_min, so
 * this reports what reach real runs keep once that is enforced point by point.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

for (const look of ['tubing', 'piping']) {
  const spec = specOf(look).decoration;
  const amplitude = spec.amplitude ?? 0;
  let faceRuns = 0;
  let moved = 0;
  let full = 0;
  let sum = 0;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), spec, 0.3, 0);
    for (const run of bp.runs) {
      if (run.surface !== 'front' && run.surface !== 'back') continue;
      faceRuns += 1;
      const zs = run.points.map((p) => p.z);
      const reach = (Math.max(...zs) - Math.min(...zs)) / 2;
      sum += reach;
      if (reach > 1e-9) moved += 1;
      if (reach >= amplitude * 0.7 - 1e-9) full += 1;
    }
    bp.dispose();
  }
  console.log(
    `${look.padEnd(7)} amplitude ${amplitude}: ${moved}/${faceRuns} face runs wander, ` +
      `${full} at full reach, mean ${(sum / Math.max(1, faceRuns)).toFixed(4)}`,
  );
}
