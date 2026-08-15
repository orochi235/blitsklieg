import { type Font, parse } from 'opentype.js';
import type { GlyphMetrics } from './layout.js';

export interface LoadedFont {
  font: Font;
  unitsPerEm: number;
  metrics: GlyphMetrics;
}

export async function loadFont(url: string): Promise<LoadedFont> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`blitsklieg: failed to load font ${url} (${res.status})`);
  const font = parse(await res.arrayBuffer());

  const metrics: GlyphMetrics = {
    advanceOf: (ch) => font.charToGlyph(ch).advanceWidth ?? 0,
    kernOf: (a, b) => font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)),
  };

  return { font, unitsPerEm: font.unitsPerEm, metrics };
}
