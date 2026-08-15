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

/** Extents of a contour's own outline, ignoring any holes hanging off it. */
function topOf(contour: THREE.Path): number {
  return Math.max(...contour.getPoints(1).map((p) => p.y));
}

function bottomOf(contour: THREE.Path): number {
  return Math.min(...contour.getPoints(1).map((p) => p.y));
}

function leftOf(contour: THREE.Path): number {
  return Math.min(...contour.getPoints(1).map((p) => p.x));
}

describe('glyphToShapes', () => {
  it('negates y, because opentype paths are y-down and three is y-up', () => {
    const [shape] = glyphToShapes(fontDrawing(box(0, 0, 10, 10)), 'A', 1);

    expect(topOf(shape as THREE.Shape)).toBe(0);
    expect(bottomOf(shape as THREE.Shape)).toBe(-10);
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
    expect(leftOf(withHole[0] as THREE.Shape)).toBe(0);
  });

  it('makes a contour nested two deep solid again', () => {
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 20, 20), ...box(2, 2, 16, 16), ...box(6, 6, 8, 8)]),
      '@',
      1,
    );

    expect(shapes).toHaveLength(2);
  });

  it('gives a hole inside an island to the island, not to the outermost contour', () => {
    // Ordered so that attaching each hole to the most recently opened contour would be wrong.
    const shapes = glyphToShapes(
      fontDrawing([
        ...box(0, 0, 40, 40),
        ...box(10, 10, 20, 20),
        ...box(14, 14, 12, 12),
        ...box(4, 4, 32, 32),
      ]),
      '@',
      1,
    );

    expect(shapes).toHaveLength(2);
    const [outer, island] = [...shapes].sort((a, b) => leftOf(a) - leftOf(b));
    expect(leftOf(outer as THREE.Shape)).toBe(0);
    expect(leftOf(island as THREE.Shape)).toBe(10);
    expect((outer as THREE.Shape).holes.map(leftOf)).toEqual([4]);
    expect((island as THREE.Shape).holes.map(leftOf)).toEqual([14]);
  });

  it('drops a contour with no drawing commands after its move', () => {
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 10, 10), { type: 'M', x: 50, y: 50 }]),
      'A',
      1,
    );

    expect(shapes).toHaveLength(1);
    expect(leftOf(shapes[0] as THREE.Shape)).toBe(0);
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
