import { describe, expect, it } from 'vitest';
import type { GlyphMetrics } from '../../src/text/layout.js';
import { layoutBlock } from '../../src/text/layout.js';
import { arrange, fitOf, placeBlock } from '../../src/text/placement.js';

const UPEM = 1000;
const ADVANCE = 600;
const SCALE_TO_EM = 1 / UPEM;
/** One advance in em. */
const STEP = ADVANCE / UPEM;

const metrics: GlyphMetrics = { advanceOf: () => ADVANCE, kernOf: () => 0 };
const drawsInk = (char: string) => char.trim().length > 0;

const place = (text: string) =>
  placeBlock(layoutBlock(text, metrics), SCALE_TO_EM, metrics, drawsInk);

describe('placeBlock', () => {
  it('centres a single line on x = 0', () => {
    const p = place('AB');
    // Positions are glyph origins, so the line spans x[0] to x[1] + one advance.
    expect(p.x[0]).toBeCloseTo(-STEP);
    expect(p.x[1]).toBeCloseTo(0);
  });

  it('centres each line independently', () => {
    const p = place('AB\nA');
    expect(p.x[2]).toBeCloseTo(-STEP / 2);
  });

  it('excludes a trailing space from the centring', () => {
    expect(place('AB ').x[0]).toBeCloseTo(place('AB').x[0] as number);
  });

  it('steps y down one line height per line', () => {
    const p = place('A\nB');
    expect(p.y[0]).toBeCloseTo(0);
    expect(p.y[1]).toBeCloseTo(-1.1);
  });

  it('reports the character, line, column and counts', () => {
    const p = place('AB\nC');
    expect(p.char).toEqual(['A', 'B', 'C']);
    expect(p.line).toEqual([0, 0, 1]);
    expect(p.column).toEqual([0, 1, 0]);
    expect(p.lineCount).toBe(2);
    expect(p.columnCount).toBe(2);
  });

  it('measures the drawn ink across the block', () => {
    expect(place('AB').inkWidth).toBeCloseTo(2 * STEP);
    expect(place('AB\nC').inkWidth).toBeCloseTo(2 * STEP);
  });
});

describe('a block that draws no ink', () => {
  it('places every glyph, unshifted', () => {
    const p = place('  ');
    expect(p.x).toHaveLength(2);
    expect(p.x[0]).toBeCloseTo(0);
    expect(p.x[1]).toBeCloseTo(STEP);
  });

  it('measures no ink', () => {
    expect(place('  ').inkWidth).toBe(0);
  });

  it('fits at the cap, centred on zero', () => {
    const fit = fitOf(place('  '), [null, null], [null, null], { width: 1, height: 1 });
    expect(fit.scale).toBe(2.2);
    expect(fit.midY).toBe(0);
  });
});

describe('arrange', () => {
  it('joins a line', () => {
    expect(arrange(['N', 'E', 'O'], 'line')).toBe('NEO');
  });

  it('breaks a stack one glyph per line', () => {
    expect(arrange(['N', 'E', 'O'], 'stack')).toBe('N\nE\nO');
  });
});

describe('fitOf', () => {
  it('scales a wide block down to the budget width', () => {
    const p = place('AAAA');
    const fit = fitOf(p, [0, 0, 0, 0], [0.7, 0.7, 0.7, 0.7], { width: 1, height: 10 });
    // Four 0.6em advances span 2.4em of ink; a 1-wide budget scales that by 1/2.4.
    expect(fit.scale).toBeCloseTo(1 / 2.4, 4);
  });

  it('puts the vertical centre of the ink at midY', () => {
    const p = place('A');
    const fit = fitOf(p, [-0.2], [0.7], { width: 100, height: 100 });
    expect(fit.midY).toBeCloseTo(0.25);
  });
});
