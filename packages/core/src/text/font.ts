import { type Font, parse } from 'opentype.js';
import type { GlyphMetrics } from './layout.js';

export interface LoadedFont {
  font: Font;
  unitsPerEm: number;
  metrics: GlyphMetrics;
}

export async function loadFont(url: string): Promise<LoadedFont> {
  const res = await fetch(url).catch((cause) => {
    throw new Error(`blitsklieg: could not fetch font ${url}`, { cause });
  });
  if (!res.ok) throw new Error(`blitsklieg: failed to load font ${url} (${res.status})`);

  let font: Font;
  try {
    font = parse(await res.arrayBuffer());
  } catch (cause) {
    // A server that answers 200 with an HTML error page lands here, not on the status check.
    throw new Error(`blitsklieg: ${url} is not a font opentype.js can parse`, { cause });
  }

  const metrics: GlyphMetrics = {
    advanceOf: (ch) => font.charToGlyph(ch).advanceWidth ?? 0,
    kernOf: (a, b) => font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)),
  };

  return { font, unitsPerEm: font.unitsPerEm, metrics };
}
