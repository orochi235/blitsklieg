/**
 * Does sharpening the tube's source path reduce the per-run radius clamp, or worsen it?
 *
 *   npm run build -w klieg && node spikes/clamp-vs-blur.mjs
 *
 * Traces each glyph two ways — through the signed distance field the pipeline ships, and straight
 * off the font contour `surfacesOf` already builds for the wall rings — and reports what
 * bend radius each run takes in both, as a multiple of the tube's own radius. Answers whether the
 * SDF's rasterisation blur is masking the constant-diameter defect. It is: the blur rounds corners,
 * which raises bend radius, and bend radius is the quantity the corner stage acts on.
 *
 * Read the numbers against `bend`: a run reading below it is one the corner stage had to fix, and
 * anything still below it after the geometry model lands is a defect rather than a statistic.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { cutIntoRuns } from '../packages/core/dist/render/tube/runs.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { tightestBend } from '../packages/core/dist/render/tube/sweep.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const spec = specOf('tubing').decoration;
/** Bend radius as a multiple of the tube radius — directly comparable to the spec's `bend`. */
const overR = (rs) => rs.map((v) => Number((v / spec.radius).toFixed(2)));
const worst = (a) => Math.min(...a);
const under = (a, bend) => a.filter((v) => v < bend).length;

console.log(
  `radius ${spec.radius}, bend ${spec.bend ?? 2}, corners ${JSON.stringify(spec.corners)}\n`,
);
for (const ch of 'NSRE') {
  const shapes = glyphToShapes(font, ch, 1);

  const bp = buildTubeBlueprint(shapes, spec, 0.3, 0);
  const viaField = overR(bp.runs.map((r) => tightestBend(r)));
  bp.dispose();

  const paths = surfacesOf(shapes, 0.3)
    .filter((s) => s.kind === 'wall')
    .map((w) => ({
      points: w.ring.map((p) => new THREE.Vector3(p.x, p.y, 0.3)),
      surface: 'front',
      closed: true,
    }));
  const direct = overR(
    cutIntoRuns(paths, {
      runs: spec.runs,
      minRun: spec.minRun,
      corners: spec.corners,
      radius: spec.radius,
      bend: spec.bend,
      seed: 0,
    }).runs.map((r) => tightestBend(r)),
  );

  const bend = spec.bend ?? 2;
  console.log(
    `${ch}  field: worst ${worst(viaField).toFixed(2)}r under-bend ` +
      `${under(viaField, bend)}/${viaField.length}` +
      `   |   contour: worst ${worst(direct).toFixed(2)}r under-bend ` +
      `${under(direct, bend)}/${direct.length}`,
  );
}
