/**
 * Which corner strategy is leaving runs bending tighter than rho_min?
 *
 *   node spikes/why-under-bend.mjs
 *
 * Task 7 fillets hard corners, but the alphabet still reports under-bend runs. This isolates the
 * cause by re-cutting the same paths under each pure strategy, so a loop splice and a fillet that
 * only fixes one vertex of a tight stretch cannot be confused for each other.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import {
  cornersByBend,
  minBendRadius,
  STYLE_FACTOR,
  vertexBends,
} from '../packages/core/dist/render/tube/bend.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { cutIntoRuns } from '../packages/core/dist/render/tube/runs.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { tightestBend } from '../packages/core/dist/render/tube/sweep.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const spec = specOf('tubing').decoration;
const rhoMin = minBendRadius(spec.radius, spec.bend);

const STRATEGIES = {
  'all break': { break: 1, connect: 0, loop: 0 },
  'all connect': { break: 0, connect: 1, loop: 0 },
  'all loop': { break: 0, connect: 0, loop: 1 },
  shipped: spec.corners,
};

console.log(`rho_min ${rhoMin.toFixed(4)} (${spec.bend}r), radius ${spec.radius}\n`);

/**
 * How many vertices bend under rho_min, against how many corners the grouping reports. Corner
 * detection collapses each consecutive stretch to its tightest vertex, so a stretch two vertices
 * wide yields one corner and one fillet, and the other vertex stays over-bent.
 */
function stretches() {
  const rhoStyle = spec.radius * STYLE_FACTOR;
  for (const ch of 'MWNSRE') {
    const shapes = glyphToShapes(font, ch, 1);
    const paths = generatePaths(surfacesOf(shapes, 0.3), spec.surfaces, {
      level: spec.level,
      spacing: spec.spacing,
      wallDepth: 0.5,
      resolution: 256,
      pad: 0.35,
    });
    let corners = 0;
    let under = 0;
    let widest = 0;
    for (const path of paths) {
      corners += cornersByBend(path.points, path.closed, rhoMin, rhoStyle).length;
      const hits = vertexBends(path.points, path.closed).filter((b) => b.rho < rhoMin);
      under += hits.length;
      let run = 0;
      let prev = -99;
      for (const b of hits) {
        run = b.index === prev + 1 ? run + 1 : 1;
        prev = b.index;
        widest = Math.max(widest, run);
      }
    }
    console.log(
      `  ${ch}  ${String(corners).padStart(2)} corners detected, ` +
        `${String(under).padStart(2)} vertices under rho_min, widest stretch ${widest}`,
    );
  }
  console.log('');
}
stretches();

for (const [name, corners] of Object.entries(STRATEGIES)) {
  const worstOf = [];
  let under = 0;
  let total = 0;
  for (const ch of 'MWNSRE') {
    const shapes = glyphToShapes(font, ch, 1);
    const paths = generatePaths(surfacesOf(shapes, 0.3), spec.surfaces, {
      level: spec.level,
      spacing: spec.spacing,
      wallDepth: 0.5,
      resolution: 256,
      pad: 0.35,
    });
    const { runs } = cutIntoRuns(paths, {
      runs: spec.runs,
      minRun: spec.minRun,
      corners,
      radius: spec.radius,
      bend: spec.bend,
      spacing: spec.spacing,
      seed: 0,
    });
    const bends = runs.map((r) => tightestBend(r));
    under += bends.filter((b) => b < rhoMin).length;
    total += bends.length;
    worstOf.push(`${ch} ${(Math.min(...bends) / spec.radius).toFixed(2)}r`);
  }
  console.log(`${name.padEnd(12)} under-bend ${String(under).padStart(2)}/${total}   ${worstOf.join('  ')}`);
}
