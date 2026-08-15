import type { Font, Glyph } from 'opentype.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

import { loadFont } from '../../src/text/font.js';

function stubFont(glyphs: Record<string, Partial<Glyph>>, kern = 0): Font {
  return {
    unitsPerEm: 1000,
    charToGlyph: (ch: string) => glyphs[ch] ?? {},
    getKerningValue: vi.fn(() => kern),
  } as unknown as Font;
}

function stubFetch(res: Partial<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => res as Response),
  );
}

beforeEach(() => {
  parse.mockReset();
  stubFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
});

describe('loadFont', () => {
  it('names the url and status when the response is not ok', async () => {
    stubFetch({ ok: false, status: 404 });

    await expect(loadFont('/fonts/x.ttf')).rejects.toThrow(
      'blitsklieg: failed to load font /fonts/x.ttf (404)',
    );
  });

  it('names the url when the network call itself rejects', async () => {
    const cause = new TypeError('fetch failed');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(cause)),
    );

    await expect(loadFont('/fonts/x.ttf')).rejects.toMatchObject({
      message: 'blitsklieg: could not fetch font /fonts/x.ttf',
      cause,
    });
  });

  it('does not blame the font file when the body read fails', async () => {
    stubFetch({
      ok: true,
      arrayBuffer: () => Promise.reject(new TypeError('terminated')),
    });

    await expect(loadFont('/fonts/x.ttf')).rejects.toThrow('terminated');
  });

  it('names the url when the bytes are not a parseable font', async () => {
    const cause = new Error('Unsupported OpenType signature 0x3c21444f');
    parse.mockImplementation(() => {
      throw cause;
    });

    await expect(loadFont('/fonts/x.ttf')).rejects.toMatchObject({
      message: 'blitsklieg: /fonts/x.ttf is not a font opentype.js can parse',
      cause,
    });
  });

  it('exposes the parsed font and its em size', async () => {
    const font = stubFont({});
    parse.mockReturnValue(font);

    const loaded = await loadFont('/fonts/x.ttf');
    expect(loaded.font).toBe(font);
    expect(loaded.unitsPerEm).toBe(1000);
  });

  it('reads advances in font units off the glyph', async () => {
    parse.mockReturnValue(stubFont({ A: { advanceWidth: 722 } }));

    const { metrics } = await loadFont('/fonts/x.ttf');
    expect(metrics.advanceOf('A')).toBe(722);
  });

  it('treats a glyph with no advance as zero width', async () => {
    parse.mockReturnValue(stubFont({ A: {} }));

    const { metrics } = await loadFont('/fonts/x.ttf');
    expect(metrics.advanceOf('A')).toBe(0);
  });

  it('kerns by glyph, since opentype takes glyphs rather than characters', async () => {
    const font = stubFont({ A: { index: 1 }, V: { index: 2 } }, -80);
    parse.mockReturnValue(font);

    const { metrics } = await loadFont('/fonts/x.ttf');
    expect(metrics.kernOf('A', 'V')).toBe(-80);
    expect(font.getKerningValue).toHaveBeenCalledWith({ index: 1 }, { index: 2 });
  });
});
