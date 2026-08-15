import { describe, expect, it } from 'vitest';
import { fitScale, layoutLine } from '../../src/text/layout.js';

// Every glyph is 10 wide; the pair A|V is kerned 3 tighter.
const metrics = {
  advanceOf: (ch: string) => (ch === ' ' ? 5 : 10),
  kernOf: (a: string, b: string) => (a === 'A' && b === 'V' ? -3 : 0),
};

describe('layoutLine', () => {
  it('places glyphs at cumulative advances', () => {
    const line = layoutLine('AB', metrics);
    expect(line.glyphs.map((g) => g.x)).toEqual([0, 10]);
    expect(line.width).toBe(20);
  });

  it('applies kerning between a kerned pair', () => {
    const line = layoutLine('AV', metrics);
    expect(line.glyphs[1]?.x).toBe(7);
    expect(line.width).toBe(17);
  });

  it('keeps spaces as positioned entries so letter indices match the string', () => {
    const line = layoutLine('A B', metrics);
    expect(line.glyphs).toHaveLength(3);
    expect(line.glyphs[1]?.char).toBe(' ');
    expect(line.glyphs[2]?.x).toBe(15);
  });

  it('an empty string has zero width and no glyphs', () => {
    expect(layoutLine('', metrics)).toEqual({ glyphs: [], width: 0 });
  });

  it('width includes the trailing advance, so trailing whitespace must be trimmed by the caller', () => {
    const line = layoutLine('A ', metrics);
    expect(line.glyphs).toHaveLength(2);
    expect(line.width).toBe(15);
  });

  it('treats an astral character as one glyph instead of splitting its surrogate pair', () => {
    const line = layoutLine('A\u{1F600}B', metrics);
    expect(line.glyphs.map((g) => g.char)).toEqual(['A', '\u{1F600}', 'B']);
    expect(line.glyphs.map((g) => g.index)).toEqual([0, 1, 2]);
    expect(line.glyphs[2]?.x).toBe(20);
  });
});

describe('fitScale', () => {
  it('fits to width when the word is wide', () => {
    expect(fitScale(100, 10, { width: 62, height: 100 })).toBeCloseTo(0.62, 5);
  });

  it('fits to height when the word is tall', () => {
    expect(fitScale(10, 100, { width: 100, height: 30 })).toBeCloseTo(0.3, 5);
  });

  it('never scales past the cap', () => {
    expect(fitScale(1, 1, { width: 1000, height: 1000 }, 2.2)).toBe(2.2);
  });

  it('returns the cap for an empty word rather than dividing by zero', () => {
    expect(Number.isFinite(fitScale(0, 0, { width: 10, height: 10 }))).toBe(true);
  });

  it('returns exactly the cap value for a zero-size word, custom cap included', () => {
    expect(fitScale(0, 0, { width: 10, height: 10 })).toBe(2.2);
    expect(fitScale(0, 0, { width: 10, height: 10 }, 5)).toBe(5);
  });
});
