/**
 * Every gradient domain and mode, as named presets, on one word.
 *
 *   npm run build -w blitsklieg && node spikes/gradient-presets.mjs [word] > out.html
 *
 * Draws runs as polylines, not tubes: the question is which vertex gets which colour, and the
 * sweep is the same whatever the sweep stage does with it. Tune stops here before touching a look.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const WORD = process.argv[2] ?? 'JACKPOT';
const base = specOf('tubing').decoration;

const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const css = (c) => `rgb(${c.map((v) => Math.round(Math.min(255, Math.max(0, v)))).join(',')})`;
const ramp = (stops, t) => {
  const s = stops.map(rgb);
  if (s.length === 1) return s[0];
  const u = Math.min(0.999999, Math.max(0, t)) * (s.length - 1);
  const k = Math.floor(u), f = u - k;
  return s[k].map((v, i) => v + (s[k + 1][i] - v) * f);
};

const DECK = [0xff2d95, 0xffd14a, 0x54ffc8];
const ADV = 0.72;

function build(spec) {
  let deal = 0, litIdx = 0;
  const letters = [...WORD].map((ch, i) => {
    const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), spec, 0.3, i);
    const out = bp.runs.map((r) => ({
      lit: r.lit, surface: r.surface, letter: i,
      deck: r.lit ? DECK[deal++ % DECK.length] : 0,
      pts: r.points.map((p) => ({ x: p.x + i * ADV, y: p.y })),
    }));
    bp.dispose();
    return out;
  });
  const runs = letters.flat();
  const lit = runs.filter((r) => r.lit);
  for (const r of lit) r.litIndex = litIdx++;
  const len = (r) => r.pts.reduce((a, p, i) => (i ? a + Math.hypot(p.x - r.pts[i-1].x, p.y - r.pts[i-1].y) : 0), 0);
  // per-letter cumulative lit length, for the `letter` domain
  for (let i = 0; i < letters.length; i++) {
    const own = letters[i].filter((r) => r.lit);
    const tot = own.reduce((a, r) => a + len(r), 0) || 1;
    let acc = 0;
    for (const r of own) { r.letterStart = acc / tot; r.letterSpan = len(r) / tot; acc += len(r); }
  }
  const xs = runs.flatMap((r) => r.pts.map((p) => p.x)), ys = runs.flatMap((r) => r.pts.map((p) => p.y));
  const b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const surfaces = [...new Set(runs.map((r) => r.surface))];
  return { runs, lit, b, surfaces, litCount: lit.length };
}

const W = 560, PAD = 14;
function panel(model, preset) {
  const { runs, b, surfaces, litCount } = model;
  const S = (W - PAD * 2) / (b.x1 - b.x0);
  const H = Math.round((b.y1 - b.y0) * S) + PAD * 2;
  const X = (v) => ((v - b.x0) * S + PAD).toFixed(1), Y = (v) => (H - PAD - (v - b.y0) * S).toFixed(1);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const maxR = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2;
  const D = preset.domain;
  const tOf = (r, k, p) => {
    switch (D.of) {
      case 'flat': return 0;
      case 'run': return k / Math.max(1, r.pts.length - 1);
      case 'letter': return r.letterStart + r.letterSpan * (k / Math.max(1, r.pts.length - 1));
      case 'runIndex': return r.litIndex / Math.max(1, litCount - 1);
      case 'surface': return surfaces.indexOf(r.surface) / Math.max(1, surfaces.length - 1);
      case 'axis': {
        const a = (D.angle ?? 0) * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
        const proj = (q) => (q.x - b.x0) * ux + (q.y - b.y0) * uy;
        const corners = [{x:b.x0,y:b.y0},{x:b.x1,y:b.y0},{x:b.x0,y:b.y1},{x:b.x1,y:b.y1}].map(proj);
        const lo = Math.min(...corners), hi = Math.max(...corners);
        return (proj(p) - lo) / (hi - lo);
      }
      case 'radial': {
        const at = D.at ?? [cx, cy];
        return Math.min(1, Math.hypot(p.x - at[0], p.y - at[1]) / maxR);
      }
    }
  };
  const colour = (r, k, p) => {
    const t = tOf(r, k, p);
    if (preset.mode === 'modulate') return rgb(r.deck).map((v, i) => v * ramp(preset.stops, t)[i] / 255);
    if (preset.mode === 'deck') return rgb(r.deck);
    return ramp(preset.stops, t);
  };
  const body = runs.map((r) => r.lit
    ? r.pts.slice(1).map((p, k) => `<line x1="${X(r.pts[k].x)}" y1="${Y(r.pts[k].y)}" x2="${X(p.x)}" y2="${Y(p.y)}" stroke="${css(colour(r, k, p))}" stroke-width="5" stroke-linecap="round"/>`).join('')
    : `<path d="${r.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)} ${Y(p.y)}`).join('')}" stroke="#26262c" stroke-width="4" fill="none" stroke-linecap="round"/>`).join('');
  const recipe = preset.mode === 'deck' ? 'colors dealt per run, no gradient'
    : `${D.of}${D.angle !== undefined ? ` ${D.angle}°` : ''}${D.at ? ' @corner' : ''} · ${preset.mode} · ${preset.stops.map((s) => '#' + s.toString(16).padStart(6, '0')).join(' → ')}`;
  return `<figure><figcaption><b>${preset.name}</b><span>${recipe}</span>${preset.note ? `<i>${preset.note}</i>` : ''}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}</svg></figure>`;
}

const P = (name, domain, mode, stops, note) => ({ name, domain, mode, stops, note });
const PRESETS = [
  P('flat — today', { of: 'flat' }, 'replace', [0xff2d95], 'the shipped baseline'),
  P('deck', { of: 'flat' }, 'deck', [], 'three colours dealt per run; what modulate preserves'),

  P('sweep', { of: 'axis', angle: 0 }, 'replace', [0xff2d95, 0x2de0ff]),
  P('sunset', { of: 'axis', angle: 0 }, 'replace', [0xffc14a, 0xff2d95, 0x7b3dff]),
  P('rise', { of: 'axis', angle: 90 }, 'replace', [0x1b2b8f, 0xff2d95], 'vertical — reads on tall words'),
  P('rake', { of: 'axis', angle: 35 }, 'replace', [0xff2d95, 0x2de0ff]),
  P('wash', { of: 'axis', angle: 0 }, 'modulate', [0x555555, 0xffffff], 'deck kept, brightness swept'),
  P('dawn', { of: 'axis', angle: 0 }, 'modulate', [0x6688ff, 0xffddaa], 'deck kept, tint swept'),

  P('halo', { of: 'radial' }, 'replace', [0xffffff, 0xff2d95, 0x3a0d5c]),
  P('spotlight', { of: 'radial' }, 'modulate', [0xffffff, 0x3a3a3a], 'deck kept, bright in the middle'),
  P('corner glow', { of: 'radial', at: [0, 0] }, 'modulate', [0xffffff, 0x444444]),

  P('per-tube', { of: 'run' }, 'replace', [0xff2d95, 0x2de0ff], 'the free one — busy'),
  P('electrode', { of: 'run' }, 'replace', [0x8a1250, 0xff5cb0, 0x8a1250], 'hot mid, cool ends — how a real tube lights'),
  P('tube wash', { of: 'run' }, 'modulate', [0x666666, 0xffffff, 0x666666], 'deck kept, each tube domed'),

  P('letterwise', { of: 'letter' }, 'replace', [0xff2d95, 0x2de0ff], 'sweep restarts each glyph'),
  P('letter wash', { of: 'letter' }, 'modulate', [0x555555, 0xffffff]),

  P('stepped', { of: 'runIndex' }, 'replace', [0xff2d95, 0xffd14a, 0x54ffc8, 0x2de0ff], 'no variation inside a run'),
  P('chase', { of: 'runIndex' }, 'modulate', [0x2a2a2a, 0xffffff], 'deck kept, ramped by run order'),
];

const shipped = build(base);
const twoFace = build({ ...base, surfaces: ['front', 'back'] });

console.log(`<meta charset="utf-8"><title>gradient presets</title>
<style>
 body{background:#100f13;color:#d8d8de;font:14px/1.5 ui-sans-serif,system-ui;margin:0;padding:26px 22px 60px}
 h1{font-size:19px;font-weight:600;margin:0 0 2px} h1 span{color:#85858f;font-weight:400;font-size:14px}
 h2{font-size:13px;font-weight:600;margin:30px 0 10px;color:#9a9aa4;text-transform:uppercase;letter-spacing:.06em}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:16px}
 figure{margin:0}
 figcaption{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;margin:0 0 5px}
 figcaption b{font-size:14px} figcaption span{color:#7c7c86;font-size:12px;font-family:ui-monospace,monospace}
 figcaption i{color:#9a8fbf;font-size:12px;font-style:normal;flex-basis:100%}
 svg{display:block;background:#08080a;border-radius:5px;width:100%;height:auto}
</style>
<h1>Gradient presets <span>· tubing · “${WORD}” · grey = unlit runs</span></h1>
<h2>Every domain, both modes</h2>
<div class="grid">${PRESETS.map((p) => panel(shipped, p)).join('')}</div>
<h2>surface domain — needs a look with more than one layer</h2>
<div class="grid">${[
  P('layered', { of: 'surface' }, 'replace', [0xff2d95, 0x2de0ff], 'front vs back, with surfaces: [front, back]'),
  P('layer wash', { of: 'surface' }, 'modulate', [0xffffff, 0x4a4a4a], 'back dimmed behind front'),
].map((p) => panel(twoFace, p)).join('')}</div>`);
