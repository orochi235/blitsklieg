import type { Block, Budget, GlyphMetrics, Line } from './layout.js';
import { fitScale, LINE_HEIGHT_EM } from './layout.js';

/** How a regrouped word is laid out: one line, or one glyph per line. */
export type Arrangement = 'line' | 'stack';

export interface Placement {
  /** Layout x per glyph, in em, already centred on its own line. */
  x: number[];
  /** Layout y per glyph, in em, before the block's vertical centring. */
  y: number[];
  line: number[];
  column: number[];
  lineCount: number;
  /** The widest line's glyph count, so a short line's columns do not stretch to fill it. */
  columnCount: number;
}

/** The string that lays `chars` out in the given arrangement. */
export function arrange(chars: readonly string[], as: Arrangement): string {
  return chars.join(as === 'stack' ? '\n' : '');
}

/**
 * Positions every glyph of a laid-out block. Each line centres on x = 0 across the glyphs that
 * draw ink — spanning `line.width` instead would push a line with a trailing space off centre.
 */
export function placeBlock(
  block: Block,
  scaleToEm: number,
  metrics: GlyphMetrics,
  drawsInk: (char: string) => boolean,
): Placement {
  const out: Placement = {
    x: [],
    y: [],
    line: [],
    column: [],
    lineCount: block.lines.length,
    columnCount: Math.max(0, ...block.lines.map((l) => l.glyphs.length)),
  };

  for (let ln = 0; ln < block.lines.length; ln++) {
    const line = block.lines[ln] as Line;
    const y = -ln * LINE_HEIGHT_EM;
    const first = out.x.length;
    let inkStart: number | null = null;
    let inkEnd = 0;

    for (const g of line.glyphs) {
      const x = g.x * scaleToEm;
      out.x.push(x);
      out.y.push(y);
      out.line.push(ln);
      out.column.push(g.index);
      if (drawsInk(g.char)) {
        inkStart ??= x;
        inkEnd = x + metrics.advanceOf(g.char) * scaleToEm;
      }
    }

    const shift = inkStart === null ? 0 : -(inkStart + inkEnd) / 2;
    for (let i = first; i < out.x.length; i++) out.x[i] = (out.x[i] as number) + shift;
  }

  return out;
}

export interface Fit {
  scale: number;
  /** Vertical centre of the drawn ink, in em. The group shifts by `-midY * scale`. */
  midY: number;
}

/**
 * Uniform scale and vertical centring for a placed block. `geoMinY`/`geoMaxY` are each glyph's
 * own vertical bounds in em, indexed like the placement; a glyph that draws nothing contributes
 * neither. Ink height, not cap height: a descender both drops the centre and eats budget.
 */
export function fitOf(
  placed: Placement,
  chars: readonly string[],
  geoMinY: readonly (number | null)[],
  geoMaxY: readonly (number | null)[],
  metrics: GlyphMetrics,
  scaleToEm: number,
  budget: Budget,
): Fit {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < placed.x.length; i++) {
    const lo = geoMinY[i];
    const hi = geoMaxY[i];
    if (lo === null || lo === undefined || hi === null || hi === undefined) continue;
    const y = placed.y[i] as number;
    minY = Math.min(minY, y + lo);
    maxY = Math.max(maxY, y + hi);
    const x = placed.x[i] as number;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + metrics.advanceOf(chars[i] as string) * scaleToEm);
  }

  const drawn = Number.isFinite(minY);
  const width = Number.isFinite(minX) ? maxX - minX : 0;
  return {
    scale: fitScale(width, drawn ? maxY - minY : 0, budget),
    midY: drawn ? (minY + maxY) / 2 : 0,
  };
}
