/**
 * Does a signed distance field over the flattened silhouette actually yield every tubing path
 * shape, without the self-intersection that breaks per-vertex polygon offsetting?
 *
 *   node spikes/tube-paths.mjs > /tmp/tube-paths.svg
 *
 * Rasterises the glyph, runs an exact Euclidean distance transform (Felzenszwalb), and marches
 * squares at several iso levels. Emits an SVG comparing them against the outline trace shipping
 * today. Throwaway: the real implementation belongs in core, this only answers "does it work".
 */
import fs from 'node:fs';
import opentype from 'opentype.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const N = 512;           // grid resolution
const PAD = 0.35;        // em of margin around the glyph, so exterior levels have room

/** Larger than any squared distance on the grid, but finite: Infinity makes the parabola
 * intersection compute Infinity - Infinity = NaN and silently voids the whole exterior field. */
const FAR = 1e20;

/** Felzenszwalb & Huttenlocher exact squared-EDT, one dimension. */
function edt1d(f, n) {
  const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
  return d;
}

/** Exact squared-EDT of a binary mask (distance to nearest zero cell). */
function edt2d(mask, w, h) {
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? FAR : 0;
    const col = edt1d(f, h);
    for (let y = 0; y < h; y++) d[y * w + x] = col[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    const row = edt1d(f, w);
    for (let x = 0; x < w; x++) d[y * w + x] = row[x];
  }
  return d;
}

/** Even-odd point-in-shape over three's contour points. */
function rasterise(contours, w, h, toGrid) {
  const mask = new Uint8Array(w * h);
  const polys = contours.map((c) => c.map(toGrid));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let inside = false;
      for (const p of polys) {
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          const a = p[i], b = p[j];
          if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        }
      }
      mask[y * w + x] = inside ? 1 : 0;
    }
  }
  return mask;
}

/** Marching squares on a scalar field, linear interpolation, returns polylines in grid space. */
function isoContour(field, w, h, level) {
  const segs = [];
  const at = (x, y) => field[y * w + x];
  const lerp = (p, q, a, b) => {
    const t = (level - a) / (b - a || 1e-9);
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v = [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)];
      const c = [{ x, y }, { x: x + 1, y }, { x: x + 1, y: y + 1 }, { x, y: y + 1 }];
      let idx = 0;
      for (let i = 0; i < 4; i++) if (v[i] < level) idx |= 1 << i;
      if (idx === 0 || idx === 15) continue;
      const e = [];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        if ((v[i] < level) !== (v[j] < level)) e.push(lerp(c[i], c[j], v[i], v[j]));
      }
      for (let i = 0; i + 1 < e.length; i += 2) segs.push([e[i], e[i + 1]]);
    }
  }
  // Stitch segments into polylines. Marching-squares emits edges in no consistent orientation,
  // so the join has to index both endpoints and be willing to walk a segment backwards.
  const key = (p) => `${Math.round(p.x * 4096)},${Math.round(p.y * 4096)}`;
  const ends = new Map();
  for (const s of segs) {
    for (const p of s) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(s);
    }
  }
  const used = new Set();
  const lines = [];
  const walk = (line, seg) => {
    for (;;) {
      const tip = line[line.length - 1];
      const next = (ends.get(key(tip)) ?? []).find((t) => !used.has(t));
      if (!next) return;
      used.add(next);
      line.push(key(next[0]) === key(tip) ? next[1] : next[0]);
    }
  };
  for (const s of segs) {
    if (used.has(s)) continue;
    used.add(s);
    const line = [s[0], s[1]];
    walk(line, s);
    line.reverse();
    walk(line, s);
    if (line.length > 3) lines.push(line);
  }
  return lines;
}


/** Radius of the circle through three consecutive points; the sweep pinches when tube radius
 *  exceeds this anywhere along a run. */
function minCurvatureRadius(line, emPerCell) {
  let min = Infinity;
  for (let i = 1; i + 1 < line.length; i++) {
    const A = line[i - 1], B = line[i], C = line[i + 1];
    const a = Math.hypot(B.x - C.x, B.y - C.y) * emPerCell;
    const b = Math.hypot(A.x - C.x, A.y - C.y) * emPerCell;
    const c = Math.hypot(A.x - B.x, A.y - B.y) * emPerCell;
    const area = Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y)) / 2 * emPerCell * emPerCell;
    if (area < 1e-12) continue;
    min = Math.min(min, (a * b * c) / (4 * area));
  }
  return min;
}


/** Resample a closed polyline at fixed arc-length spacing, then smooth. Marching squares emits
 *  staircase noise at grid scale; curvature measured before this reports the raster, not the glyph. */
function resample(line, spacingCells) {
  const closed = line.slice();
  let total = 0;
  const seg = [];
  for (let i = 1; i < closed.length; i++) {
    const d = Math.hypot(closed[i].x - closed[i-1].x, closed[i].y - closed[i-1].y);
    seg.push(d); total += d;
  }
  const n = Math.max(8, Math.round(total / spacingCells));
  const step = total / n;
  const out = [];
  let acc = 0, idx = 0, walked = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (idx < seg.length - 1 && walked + seg[idx] < target) { walked += seg[idx]; idx++; }
    const t = seg[idx] > 0 ? (target - walked) / seg[idx] : 0;
    out.push({
      x: closed[idx].x + (closed[idx+1].x - closed[idx].x) * t,
      y: closed[idx].y + (closed[idx+1].y - closed[idx].y) * t,
    });
  }
  return out;
}

function smooth(line, passes) {
  let cur = line;
  for (let p = 0; p < passes; p++) {
    const next = cur.map((_, i) => {
      const a = cur[(i - 1 + cur.length) % cur.length], b = cur[i], c = cur[(i + 1) % cur.length];
      return { x: a.x * 0.25 + b.x * 0.5 + c.x * 0.25, y: a.y * 0.25 + b.y * 0.5 + c.y * 0.25 };
    });
    cur = next;
  }
  return cur;
}

const font = opentype.parse(fs.readFileSync('apps/lab/public/font.ttf').buffer);
const CHARS = (process.argv[2] ?? 'ROSE').split('');
const LEVELS = [
  { em: -0.09, color: '#8aff80', label: 'inset -0.09' },
  { em: -0.045, color: '#ffd166', label: 'inset -0.045' },
  { em: 0, color: '#ff2d95', label: 'outline 0' },
  { em: 0.045, color: '#2de1ff', label: 'standoff +0.045' },
  { em: 0.12, color: '#c58bff', label: 'standoff +0.12' },
];

const CELL = 240;
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL * CHARS.length}" height="${CELL + 40}" viewBox="0 0 ${CELL * CHARS.length} ${CELL + 40}">`;
sheet += `<rect width="100%" height="100%" fill="#0b0b12"/>`;
sheet += `<text x="12" y="24" fill="#8b8b9a" font-family="ui-monospace,monospace" font-size="14">signed distance field level sets — one field per glyph, ${LEVELS.map(l => l.label).join('  ')}</text>`;

CHARS.forEach((CHAR, ci) => {
  const shapes = glyphToShapes(font, CHAR, 1);
  const contours = [];
  for (const s of shapes) for (const c of [s, ...s.holes]) contours.push(c.getPoints(48));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of contours) for (const p of c) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
  const span = Math.max(maxX - minX, maxY - minY);
  const scale = (N - 1) / span;
  const toGrid = (p) => ({ x: (p.x - minX) * scale, y: (p.y - minY) * scale });
  const emPerCell = 1 / scale;

  const mask = rasterise(contours, N, N, toGrid);
  const inv = mask.map((m) => (m ? 0 : 1));
  const toBackground = edt2d(mask, N, N);
  const toSolid = edt2d(inv, N, N);
  const sdf = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) {
    sdf[i] = (mask[i] ? -Math.sqrt(toBackground[i]) : Math.sqrt(toSolid[i])) * emPerCell;
  }

  const ox = ci * CELL;
  const toSvg = (p) => `${(ox + p.x / (N - 1) * CELL).toFixed(2)},${(36 + CELL - p.y / (N - 1) * CELL).toFixed(2)}`;
  for (const c of contours) {
    sheet += `<polygon points="${c.map((p) => toSvg(toGrid(p))).join(' ')}" fill="#1b1b2a"/>`;
  }
  const counts = [];
  for (const L of LEVELS) {
    const lines = isoContour(sdf, N, N, L.em);
    const SPACING_EM = 0.02;
    let rawMin = Infinity, cookedMin = Infinity, pts = 0;
    const cooked = [];
    for (const line of lines) {
      rawMin = Math.min(rawMin, minCurvatureRadius(line, emPerCell));
      const r = smooth(resample(line, SPACING_EM / emPerCell), 3);
      cooked.push(r); pts += r.length;
      cookedMin = Math.min(cookedMin, minCurvatureRadius(r, emPerCell));
    }
    lines.length = 0; lines.push(...cooked);
    const f = (v) => (v === Infinity ? 'n/a' : v.toFixed(4));
    // Does the minRun floor already remove the paths that are too tight to sweep?
    const TUBE_R = 0.045, MIN_RUN = 0.15;
    let tightAndLong = 0, tightTotal = 0;
    for (const r of cooked) {
      const rad = minCurvatureRadius(r, emPerCell);
      let len = 0;
      for (let i = 1; i < r.length; i++) len += Math.hypot(r[i].x-r[i-1].x, r[i].y-r[i-1].y) * emPerCell;
      if (rad < TUBE_R) { tightTotal++; if (len >= MIN_RUN) tightAndLong++; }
    }
    counts.push(`${L.em}: ${lines.length}p resampled_r=${f(cookedMin)} tight=${tightTotal} tight&survives_floor=${tightAndLong}`);
    for (const line of lines) {
      sheet += `<polyline points="${line.map(toSvg).join(' ')}" fill="none" stroke="${L.color}" stroke-width="2" stroke-linecap="round" opacity="0.9"/>`;
    }
  }
  process.stderr.write(`${CHAR}  paths per level: ${counts.join('  ')}\n`);
});
sheet += `</svg>`;
process.stdout.write(sheet);
