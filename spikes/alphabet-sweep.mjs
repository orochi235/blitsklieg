/**
 * Where is the tube's sharpest corner across the whole alphabet, and does `bend = 2` survive it?
 *
 *   node spikes/alphabet-sweep.mjs --out sweep.md
 *
 * Every number in the tube geometry spec came from `NSRE`, four letters chosen for shape variety
 * rather than for being extreme. This measures all 26 on both shipped looks: the tightest bend
 * radius each glyph asks the tube to take, how many corners are hard at several `bend` values, and
 * whether a fillet at that radius has room to sit. Answers whether the N's apex is really the worst
 * case, and what the largest admissible `bend` is.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { cutIntoRuns } from '../packages/core/dist/render/tube/runs.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { sweepRadius } from '../packages/core/dist/render/tube/sweep.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DEPTH = 0.3;
const BENDS = [1.25, 2, 3];
/** Mirrors index.ts: the field the pipeline builds its contours on. */
const FIELD = { resolution: 256, pad: 0.35 };

const outFlag = process.argv.indexOf('--out');
const outPath = outFlag === -1 ? null : process.argv[outFlag + 1];

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const median = (xs) => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const deg = (rad) => (rad * 180) / Math.PI;

/**
 * Every vertex's bend radius, as the spec defines it: on a path resampled to spacing `s`, a turn of
 * `theta` has bend radius `s / (2 sin(theta/2))`. Uses the two real adjacent segment lengths rather
 * than the nominal spacing, because the resampler leaves a short final segment on an open path.
 */
function vertexBends(points, closed) {
  const n = points.length;
  const out = [];
  const count = closed ? n : n - 2;
  const first = closed ? 0 : 1;
  for (let k = 0; k < count; k++) {
    const i = first + k;
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const a = cur.clone().sub(prev);
    const b = next.clone().sub(cur);
    if (a.lengthSq() < 1e-18 || b.lengthSq() < 1e-18) continue;
    const step = (a.length() + b.length()) / 2;
    const turn = a.normalize().angleTo(b.normalize());
    const rho = turn < 1e-9 ? Number.POSITIVE_INFINITY : step / (2 * Math.sin(turn / 2));
    out.push({ index: i, turn, rho, step });
  }
  return out;
}

/** Collapses each consecutive stretch below `limit` to its tightest vertex, as `cornersOf` does. */
function cornersBelow(bends, limit) {
  const hits = bends.filter((b) => b.rho < limit);
  if (hits.length === 0) return [];
  const groups = [[hits[0]]];
  for (let k = 1; k < hits.length; k++) {
    const group = groups[groups.length - 1];
    if (hits[k].index === group[group.length - 1].index + 1) group.push(hits[k]);
    else groups.push([hits[k]]);
  }
  return groups.map((g) => g.reduce((a, b) => (b.rho < a.rho ? b : a)));
}

/** Arc length between consecutive corners — the leg a fillet's setback has to fit inside. */
function legLengths(points, closed, corners) {
  if (corners.length === 0) return [];
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[cum.length - 1] + points[i].distanceTo(points[i - 1]));
  }
  const total = cum[cum.length - 1];
  const at = corners.map((c) => cum[Math.min(c.index, cum.length - 1)]);
  const legs = [];
  for (let k = 0; k < at.length; k++) {
    const next = at[(k + 1) % at.length];
    let span = next - at[k];
    if (span <= 0) span = closed ? span + total : Number.POSITIVE_INFINITY;
    legs.push(span);
  }
  return legs;
}

function measure(lookName) {
  const spec = specOf(lookName).decoration;
  const r = spec.radius;
  const styleFlag = process.argv.indexOf('--style');
  const rhoStyle = (styleFlag === -1 ? 1.76 : Number(process.argv[styleFlag + 1])) * r;
  const rows = [];

  ALPHABET.split('').forEach((ch, i) => {
    const shapes = glyphToShapes(font, ch, 1);
    const paths = generatePaths(surfacesOf(shapes, DEPTH), spec.surfaces, {
      level: spec.level,
      spacing: spec.spacing,
      wallDepth: spec.wallDepth ?? 0.5,
      wallRise: spec.wallRise,
      resolution: FIELD.resolution,
      pad: FIELD.pad,
    });

    const corners = [];
    const legsAll = [];
    for (const path of paths) {
      const found = cornersBelow(vertexBends(path.points, path.closed), rhoStyle);
      corners.push(...found);
      legsAll.push(...legLengths(path.points, path.closed, found));
    }

    const tightest = corners.length
      ? Math.min(...corners.map((c) => c.rho))
      : Number.POSITIVE_INFINITY;
    const hard = {};
    const setback = {};
    const noRoom = {};
    for (const bend of BENDS) {
      const rhoMin = bend * r;
      const picked = [];
      corners.forEach((c, k) => {
        if (c.rho < rhoMin) picked.push({ c, leg: legsAll[k] ?? Number.POSITIVE_INFINITY });
      });
      hard[bend] = picked.length;
      const backs = picked.map((p) => rhoMin * Math.tan(Math.min(p.c.turn, Math.PI - 1e-6) / 2));
      setback[bend] = backs.length ? Math.max(...backs) : 0;
      noRoom[bend] = picked.filter((p, k) => backs[k] > p.leg / 2).length;
    }

    // Today's clamp, for the same glyph, so the two models sit side by side.
    const cut = cutIntoRuns(paths, {
      runs: spec.runs,
      minRun: spec.minRun,
      corners: spec.corners,
      radius: r,
      seed: 0,
    });
    const pcts = cut.runs.map((run) => (sweepRadius(run, r) / r) * 100);
    const worst = pcts.length ? Math.min(...pcts) : 100;

    rows.push({
      ch,
      corners: corners.length,
      tightest,
      tightestOverR: tightest / r,
      medianTurn: median(corners.map((c) => c.turn)),
      hard,
      setback,
      noRoom,
      worst,
      clampedCount: pcts.filter((p) => p < 99).length,
      runs: pcts.length,
    });

    const d = rows[rows.length - 1];
    console.log(
      `${String(i + 1).padStart(2)}/26  ${ch}  ${lookName.padEnd(7)}` +
        ` tightest ${tightest.toFixed(4)} (${d.tightestOverR.toFixed(2)}r)` +
        `  hard@2 ${String(hard[2]).padStart(2)}` +
        `  setback@2 ${setback[2].toFixed(3)}` +
        `  noroom@2 ${noRoom[2]}` +
        `  clamp ${worst.toFixed(0)}% ${d.clampedCount}/${d.runs}`,
    );
  });

  return { lookName, r, spacing: spec.spacing, rows };
}

function render({ lookName, r, spacing, rows }) {
  const lines = [];
  lines.push(`## ${lookName} — radius ${r}, spacing ${spacing}`);
  lines.push('');
  lines.push(
    '| ch | corners | tightest | /r | med turn | hard@1.25 | hard@2 | hard@3 |' +
      ' setback@2 | setback@3 | no room@2 | worst run | clamped |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const d of rows) {
    lines.push(
      `| ${d.ch} | ${d.corners} | ${d.tightest.toFixed(4)} | ${d.tightestOverR.toFixed(2)} |` +
        ` ${deg(d.medianTurn).toFixed(0)}° | ${d.hard[1.25]} | ${d.hard[2]} | ${d.hard[3]} |` +
        ` ${d.setback[2].toFixed(3)} | ${d.setback[3].toFixed(3)} | ${d.noRoom[2]} |` +
        ` ${d.worst.toFixed(0)}% | ${d.clampedCount}/${d.runs} |`,
    );
  }
  const byTight = [...rows].sort((a, b) => a.tightestOverR - b.tightestOverR);
  lines.push('');
  lines.push(
    `Sharpest: ${byTight
      .slice(0, 6)
      .map((d) => `${d.ch} ${d.tightestOverR.toFixed(2)}r`)
      .join(', ')}`,
  );
  lines.push(
    `Largest bend every glyph clears without a hard corner: ` +
      `${byTight[0].tightestOverR.toFixed(2)} (letter ${byTight[0].ch})`,
  );
  for (const bend of BENDS) {
    const glyphs = rows.filter((d) => d.hard[bend] > 0).length;
    const total = rows.reduce((a, d) => a + d.hard[bend], 0);
    const worstSet = Math.max(...rows.map((d) => d.setback[bend]));
    const roomless = rows.reduce((a, d) => a + d.noRoom[bend], 0);
    lines.push(
      `bend ${bend}: ${total} hard corners across ${glyphs}/26 glyphs, ` +
        `largest setback ${worstSet.toFixed(3)} em, ${roomless} without room`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

const report = [];
for (const look of ['tubing', 'piping']) {
  console.log(`\n--- ${look} ---`);
  report.push(render(measure(look)));
}
const text = `# Alphabet sweep — tightest bend per glyph\n\n${report.join('\n')}`;
if (outPath) {
  writeFileSync(outPath, text);
  console.log(`\nwrote ${outPath}`);
} else {
  console.log(`\n${text}`);
}
