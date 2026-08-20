/**
 * Does sharpening the tube's source path reduce the per-run radius clamp, or worsen it?
 *
 *   npm run build -w blitsklieg && node spikes/clamp-vs-blur.mjs
 *
 * Traces each glyph two ways — through the signed distance field the pipeline ships, and straight
 * off the font contour `surfacesOf` already builds for the wall rings — and reports what
 * `sweepRadius` allows each run in both. Answers whether the SDF's rasterisation blur is masking
 * the constant-diameter defect. It is: the blur rounds corners, which raises curvature radius,
 * which is the quantity the clamp measures.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { cutIntoRuns } from '../packages/core/dist/render/tube/runs.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { sweepRadius } from '../packages/core/dist/render/tube/sweep.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const spec = specOf('tubing').decoration;
const pct = (rs) => rs.map((v) => Math.round((v / spec.radius) * 100));
const worst = (a) => Math.min(...a);
const clamped = (a) => a.filter((v) => v < 99).length;

console.log(`requested radius ${spec.radius}, corners ${JSON.stringify(spec.corners)}\n`);
for (const ch of 'NSRE') {
  const shapes = glyphToShapes(font, ch, 1);

  const bp = buildTubeBlueprint(shapes, spec, 0.3, 0);
  const viaField = pct(bp.runs.map((r) => sweepRadius(r, spec.radius)));
  bp.dispose();

  const paths = surfacesOf(shapes, 0.3)
    .filter((s) => s.kind === 'wall')
    .map((w) => ({
      points: w.ring.map((p) => new THREE.Vector3(p.x, p.y, 0.3)),
      surface: 'front',
      closed: true,
    }));
  const direct = pct(
    cutIntoRuns(paths, {
      runs: spec.runs,
      minRun: spec.minRun,
      corners: spec.corners,
      radius: spec.radius,
      seed: 0,
    }).runs.map((r) => sweepRadius(r, spec.radius)),
  );

  console.log(
    `${ch}  field: worst ${worst(viaField)}% clamped ${clamped(viaField)}/${viaField.length}` +
      `   |   contour: worst ${worst(direct)}% clamped ${clamped(direct)}/${direct.length}`,
  );
}
