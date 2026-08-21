/**
 * Is a corner 2-4 vertices wide because of the distance field, or because of arc-length resampling?
 *
 *   npm run build -w klieg && node spikes/corner-width.mjs
 *
 * The group-filleting work is justified by the claim that the field's blur widens every corner into
 * a stretch, and so would be deleted by tracing the font's beziers. This measures the same glyphs
 * three ways at one spacing — through the field, straight off the contour, and against a synthetic
 * corner with no field anywhere in it — so resampling and rasterisation cannot be confused.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { specOf } from '../packages/core/dist/render/looks.js';
import { cornersByBend, minBendRadius, STYLE_FACTOR, vertexBends } from '../packages/core/dist/render/tube/bend.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { resample } from '../packages/core/dist/render/tube/resample.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const spec = specOf('tubing').decoration;
const rhoMin = minBendRadius(spec.radius, spec.bend);

/** Consecutive runs of under-rho_min vertices, as a histogram of stretch widths. */
function stretchWidths(paths) {
  const widths = [];
  for (const path of paths) {
    const hits = vertexBends(path.points, path.closed).filter((b) => b.rho < rhoMin);
    let run = 0;
    let prev = -99;
    for (const b of hits) {
      if (b.index === prev + 1) run += 1;
      else {
        if (run) widths.push(run);
        run = 1;
      }
      prev = b.index;
    }
    if (run) widths.push(run);
  }
  return widths;
}

const summarise = (widths) => {
  const counts = {};
  for (const w of widths) counts[w] = (counts[w] ?? 0) + 1;
  const total = widths.reduce((a, b) => a + b, 0);
  const shape = Object.keys(counts)
    .sort()
    .map((k) => `${k}x${counts[k]}`)
    .join(' ');
  return `${String(widths.length).padStart(2)} corners, ${String(total).padStart(2)} vertices, widest ${
    widths.length ? Math.max(...widths) : 0
  }  [${shape}]`;
};

/**
 * The turn still left at the first vertex *outside* a corner's detected stretch. A corner the legs
 * run straight into reads near zero here; anything else is a shoulder the stretch does not cover,
 * and a leg direction measured on it is already turning.
 */
function shoulders(paths) {
  const out = [];
  for (const path of paths) {
    const bends = vertexBends(path.points, path.closed);
    const byIndex = new Map(bends.map((b) => [b.index, b]));
    for (const c of cornersByBend(path.points, path.closed, rhoMin, spec.radius * STYLE_FACTOR)) {
      const n = path.points.length;
      for (const side of [
        c.index - c.groupBefore - 1,
        c.index + c.groupAfter + 1,
      ]) {
        const b = byIndex.get(((side % n) + n) % n);
        if (b) out.push((b.turn * 180) / Math.PI);
      }
    }
  }
  return out;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

const fieldPaths = (shapes) =>
  generatePaths(surfacesOf(shapes, 0.3), spec.surfaces, {
    level: spec.level,
    spacing: spec.spacing,
    wallDepth: 0.5,
    resolution: 256,
    pad: 0.35,
  });

/** The same contours the field rasterises, resampled at the pipeline's spacing and never gridded. */
const contourPaths = (shapes) =>
  surfacesOf(shapes, 0.3)
    .filter((s) => s.kind === 'wall')
    .map((w) => ({
      points: resample(w.ring, spec.spacing).map((p) => new THREE.Vector3(p.x, p.y, 0.3)),
      closed: true,
    }));

console.log(`rho_min ${rhoMin.toFixed(4)} (${spec.bend}r), spacing ${spec.spacing}\n`);
for (const ch of 'MWNSRE') {
  const shapes = glyphToShapes(font, ch, 1);
  for (const [label, paths] of [
    ['field  ', fieldPaths(shapes)],
    ['contour', contourPaths(shapes)],
  ]) {
    const sh = shoulders(paths);
    console.log(
      `  ${ch} ${label}  ${summarise(stretchWidths(paths))}` +
        `  shoulder turn median ${median(sh).toFixed(1)}deg max ${(sh.length ? Math.max(...sh) : 0).toFixed(1)}deg`,
    );
  }
}

// A square has four exactly-sharp corners and no field anywhere near it. Its side length decides
// where samples land relative to each corner, which is what decides whether one vertex takes the
// whole turn: 0.4 is a whole number of 0.02 steps and lands on them exactly, 0.41 does not.
console.log('\n  synthetic square, no field, resampled at the same spacing:');
for (const side of [0.4, 0.41, 0.413, 0.417]) {
  const square = [
    { x: 0, y: 0 },
    { x: side, y: 0 },
    { x: side, y: side },
    { x: 0, y: side },
  ];
  const pts = resample(square, spec.spacing).map((p) => new THREE.Vector3(p.x, p.y, 0));
  console.log(`    side ${side}  ${summarise(stretchWidths([{ points: pts, closed: true }]))}`);
}
