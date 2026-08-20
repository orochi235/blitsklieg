/**
 * What `level` does to a glyph's traced path, drawn.
 *
 *   npm run build -w blitsklieg && node spikes/level-explainer.mjs [letters]
 *
 * `level` is an isocontour level in em: negative rides inside the letter, zero on its outline,
 * positive stands off outside it. It reads as unpredictable because it is topological rather than a
 * scale — as the level moves, contours merge, counters close and thin strokes vanish, so the contour
 * count is a step function and the run count jumps with it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const spec = specOf('tubing').decoration;
const LETTERS = process.argv[2] ?? 'OBS';
const LEVELS = [-0.06, -0.03, -0.015, 0, 0.015, 0.03, 0.06];

const cells = [];
let i = 0;
for (const ch of LETTERS) {
  const shapes = glyphToShapes(font, ch, 1);
  const surfaces = surfacesOf(shapes, 0.3);
  const outline = surfaces.filter((s) => s.kind === 'wall').map((w) => w.ring);
  for (const level of LEVELS) {
    const paths = generatePaths(surfaces, ['front'], {
      level, spacing: spec.spacing, wallDepth: 0.5, resolution: 256, pad: 0.35,
    });
    cells.push({ ch, level, outline, paths });
    i++;
    console.log(`  ${String(i).padStart(2)}/${LETTERS.length * LEVELS.length}  ${ch} level ${String(level).padStart(6)} -> ${paths.length} contour(s)`);
  }
}

const all = cells.flatMap((c) => [...c.outline.flat(), ...c.paths.flatMap((p) => p.points)]);
const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x));
const minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
const CW = 250, CH_ = 300, HEAD = 56, M = 26;
const S = Math.min((CW - M * 2) / (maxX - minX), (CH_ - M * 2 - 26) / (maxY - minY));
const W = CW * LEVELS.length, H = HEAD + CH_ * LETTERS.length;
const parts = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#0d0f13"/>`];
LEVELS.forEach((lv, col) => {
  parts.push(`<text class="hd" x="${col * CW + CW / 2}" y="34" text-anchor="middle">level ${lv > 0 ? '+' : ''}${lv}</text>`);
});
for (const c of cells) {
  const col = LEVELS.indexOf(c.level), row = LETTERS.indexOf(c.ch);
  const ox = col * CW + M, oy = HEAD + row * CH_ + M;
  const X = (p) => ox + (p.x - minX) * S, Y = (p) => oy + (maxY - p.y) * S;
  for (const ring of c.outline) {
    parts.push(`<polygon points="${ring.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}" fill="#242a33"/>`);
  }
  for (const path of c.paths) {
    parts.push(`<polygon points="${path.points.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}" fill="none" stroke="#22d3ee" stroke-width="2.4"/>`);
  }
  const n = c.paths.length;
  parts.push(`<text class="cap" x="${ox}" y="${oy + (maxY - minY) * S + 20}" fill="${n === c.outline.length ? '#8b96a5' : '#fbbf24'}">${n} contour${n === 1 ? '' : 's'}${n === c.outline.length ? '' : ` (glyph has ${c.outline.length})`}</text>`);
}
writeFileSync(new URL('../test-results/level.svg', import.meta.url),
`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>.hd{font:16px ui-monospace,monospace;fill:#e2e8f0}.cap{font:12px ui-monospace,monospace}</style>
${parts.join('\n')}</svg>`);
console.log('\nwrote test-results/level.svg');
