import type { Font, PathCommand } from 'opentype.js';
import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GLYPH_OPTIONS,
  GlyphCache,
  buildGlyphGeometry,
  glyphToShapes,
} from '../../src/text/glyphs.js';

describe('GlyphCache', () => {
  it('builds a geometry once per distinct key', () => {
    const build = vi.fn((char: string) => ({ char, dispose: vi.fn() }));
    const cache = new GlyphCache(build);

    cache.get('A', 0.3);
    cache.get('A', 0.3);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('treats a different depth as a different geometry', () => {
    const build = vi.fn((char: string) => ({ char, dispose: vi.fn() }));
    const cache = new GlyphCache(build);

    cache.get('A', 0.3);
    cache.get('A', 0.5);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('reuses one geometry across repeated letters in a word', () => {
    const build = vi.fn((char: string) => ({ char, dispose: vi.fn() }));
    const cache = new GlyphCache(build);

    for (const ch of 'BONUS ROUND') cache.get(ch, 0.3);
    expect(build).toHaveBeenCalledTimes(new Set('BONUS ROUND').size);
  });

  it('disposes every cached geometry on dispose and empties itself', () => {
    const made: { dispose: ReturnType<typeof vi.fn> }[] = [];
    const cache = new GlyphCache((char: string) => {
      const g = { char, dispose: vi.fn() };
      made.push(g);
      return g;
    });

    cache.get('A', 0.3);
    cache.get('B', 0.3);
    cache.dispose();

    expect(made).toHaveLength(2);
    for (const g of made) expect(g.dispose).toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });
});

/** A font whose only glyph draws the given commands, so contour nesting is exercised exactly. */
function fontDrawing(commands: PathCommand[]): Font {
  return { charToGlyph: () => ({ getPath: () => ({ commands }) }) } as unknown as Font;
}

function box(x: number, y: number, w: number, h: number): PathCommand[] {
  return [
    { type: 'M', x, y },
    { type: 'L', x: x + w, y },
    { type: 'L', x: x + w, y: y + h },
    { type: 'L', x, y: y + h },
    { type: 'Z' },
  ];
}

/** Highest y a shape's own outline reaches, ignoring its holes. */
function topOf(shape: THREE.Shape): number {
  return Math.max(...shape.getPoints(1).map((p) => p.y));
}

describe('glyphToShapes', () => {
  it('negates y, because opentype paths are y-down and three is y-up', () => {
    const [shape] = glyphToShapes(fontDrawing(box(0, 0, 10, 10)), 'A', 1);

    expect(topOf(shape as THREE.Shape)).toBe(0);
    expect(Math.min(...(shape as THREE.Shape).getPoints(1).map((p) => p.y))).toBe(-10);
  });

  it('nests a counter as a hole instead of a second solid shape', () => {
    const shapes = glyphToShapes(fontDrawing([...box(0, 0, 10, 10), ...box(3, 3, 4, 4)]), 'O', 1);

    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.holes).toHaveLength(1);
  });

  it('keeps disjoint contours as separate shapes', () => {
    const shapes = glyphToShapes(fontDrawing([...box(0, 0, 4, 4), ...box(10, 0, 4, 4)]), 'i', 1);

    expect(shapes).toHaveLength(2);
    expect(shapes.every((s) => s.holes.length === 0)).toBe(true);
  });

  it('attaches a counter to the contour containing it, not the one preceding it', () => {
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 10, 10), ...box(20, 0, 10, 10), ...box(3, 3, 4, 4)]),
      '%',
      1,
    );

    expect(shapes).toHaveLength(2);
    const withHole = shapes.filter((s) => s.holes.length > 0);
    expect(withHole).toHaveLength(1);
    expect(topOf(withHole[0] as THREE.Shape)).toBe(0);
    expect(Math.min(...(withHole[0] as THREE.Shape).getPoints(1).map((p) => p.x))).toBe(0);
  });

  it('makes a contour nested two deep solid again', () => {
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 20, 20), ...box(2, 2, 16, 16), ...box(6, 6, 8, 8)]),
      '@',
      1,
    );

    expect(shapes).toHaveLength(2);
  });

  it('returns nothing for a glyph with no outline', () => {
    expect(glyphToShapes(fontDrawing([]), ' ', 1)).toEqual([]);
  });
});

describe('buildGlyphGeometry', () => {
  it('computes a bounding box, which callers use to center a word', () => {
    const geo = buildGlyphGeometry(fontDrawing(box(0, 0, 10, 10)), 'A', 1, DEFAULT_GLYPH_OPTIONS);

    expect(geo.boundingBox).not.toBeNull();
    expect(geo.boundingBox?.max.y).toBeGreaterThan(0);
  });
});
