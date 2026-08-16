export interface GlyphMetrics {
  advanceOf(char: string): number;
  kernOf(left: string, right: string): number;
}

export interface PlacedGlyph {
  char: string;
  /** Pen x at this glyph's origin, in font units. */
  x: number;
  index: number;
}

export interface Line {
  glyphs: PlacedGlyph[];
  /** Sum of every glyph's advance, including the last — trim trailing whitespace before centering on it. */
  width: number;
}

/** Iterates by Unicode code point, so an astral character (e.g. an emoji) is one glyph, not a split surrogate pair. */
export function layoutLine(text: string, metrics: GlyphMetrics): Line {
  const chars = Array.from(text);
  const glyphs: PlacedGlyph[] = [];
  let pen = 0;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] as string;
    if (i > 0) pen += metrics.kernOf(chars[i - 1] as string, char);
    glyphs.push({ char, x: pen, index: i });
    pen += metrics.advanceOf(char);
  }

  return { glyphs, width: pen };
}

/** Leading between baselines. Display capitals want less than the 1.2 that suits body text. */
export const LINE_HEIGHT_EM = 1.1;

export interface Block {
  lines: Line[];
  /** Widest line, in font units. */
  width: number;
}

/** Splits on newlines and lays each line out. The separator is consumed, never laid out. */
export function layoutBlock(text: string, metrics: GlyphMetrics): Block {
  const lines = text.split(/\r?\n/).map((seg) => layoutLine(seg, metrics));
  return { lines, width: Math.max(0, ...lines.map((l) => l.width)) };
}

export interface Budget {
  width: number;
  height: number;
}

/**
 * Uniform scale fitting the word inside the budget on both axes. Height matters as much as
 * width: idle rotation swings the word toward the camera, so a width-only fit overflows.
 * An empty word has no ratio to compute, so it falls back to `cap`, the same bound a normal
 * word is clamped to.
 */
export function fitScale(width: number, height: number, budget: Budget, cap = 2.2): number {
  const byWidth = width > 0 ? budget.width / width : Number.POSITIVE_INFINITY;
  const byHeight = height > 0 ? budget.height / height : Number.POSITIVE_INFINITY;
  return Math.min(byWidth, byHeight, cap);
}
