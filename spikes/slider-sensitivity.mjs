/**
 * Which tube lab sliders actually change anything, and over what part of their range?
 *
 *   npm run build -w blitsklieg && node spikes/slider-sensitivity.mjs [look] [letters]
 *
 * Sweeps each `TubeSpec` field the rail exposes across the rail's own min and max, and counts the
 * distinct outputs. A field that yields one outcome is a dead control; a field that yields two over
 * twenty steps is a cliff wearing a slider. Mirrors the rail's ranges, so a change there needs a
 * change here.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const LOOK = process.argv[2] ?? 'tubing';
const LETTERS = process.argv[3] ?? 'SM';
const base = specOf(LOOK).decoration;

/** The rail's own ranges, in spec units. */
const FIELDS = [
  ['radius', 0.001, 0.12],
  ['bend', 1.25, 4],
  ['segments', 3, 32],
  ['spacing', 0.002, 0.08],
  ['level', -0.12, 0.12],
  ['blockout', 0, 1],
  ['runs', 1, 24],
  ['minRun', 0, 0.3],
  ['amplitude', 0, 0.08],
  ['wallDepth', 0, 1],
  ['wallRise', 0, 1],
];
const STEPS = 9;

const sig = (spec) => {
  let out = '';
  for (const ch of LETTERS) {
    const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), spec, 0.3, 0);
    const len = bp.runs.reduce((a, r) => a + r.length, 0);
    // Vertex count and centroid included: `segments` changes only the swept mesh, and `wallDepth`
    // only translates a ring in z. A signature built from run counts and lengths calls both dead.
    const verts = [...bp.lit, ...bp.dark].reduce((a, g) => a + g.attributes.position.count, 0);
    let cz = 0;
    let n = 0;
    for (const r of bp.runs) for (const p of r.points) { cz += p.x + p.y + p.z * 1000; n++; }
    out += `${bp.runs.length}/${bp.runs.filter((r) => r.lit).length}/${len.toFixed(3)}/${verts}/`;
    out += `${(cz / Math.max(1, n)).toFixed(5)}/`;
    out += `${bp.runs.map((r) => r.points.length).join('.')};`;
    bp.dispose();
  }
  return out;
};

for (const [surfLabel, surfaces] of [
  ['as shipped', base.surfaces],
  ['with wall enabled', [...new Set([...base.surfaces, 'wall'])]],
]) {
console.log(`\n${LOOK} on ${LETTERS}, ${STEPS} steps per range — surfaces: ${surfaces} (${surfLabel})\n`);
console.log('  field       distinct   run counts across the sweep');
const rows = [];
for (const [key, lo, hi] of FIELDS) {
  const seen = new Map();
  const counts = [];
  for (let i = 0; i < STEPS; i++) {
    const v = lo + ((hi - lo) * i) / (STEPS - 1);
    const s = sig({ ...base, surfaces, [key]: v });
    if (!seen.has(s)) seen.set(s, v);
    counts.push(s.split('/')[0]);
  }
  rows.push([key, seen.size, counts.join(' ')]);
  console.log(`  ${key.padEnd(11)} ${String(seen.size).padStart(2)}/${STEPS}      ${counts.join(' ')}`);
}
const dead = rows.filter(([, n]) => n === 1);
console.log(`  ${dead.length} of ${rows.length} fields do nothing at all: ${dead.map(([k]) => k).join(', ') || 'none'}`);
}
