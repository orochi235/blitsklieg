import { describe, expect, it } from 'vitest';
import { splitStrategy } from 'windease';
import { balancedTree } from '../../../dev/tube-lab/src/tree.js';

const CONTAINER = { w: 1200, h: 800 };
const OPTIONS = { recursive: true, gutterSize: 6 };

function layoutOf(count: number) {
  const items = Array.from({ length: count }, (_, i) => ({ id: `p${i}` }));
  // The lab's own tree, not `splitStrategy.initialState` — see tree.ts for why.
  const state = balancedTree(items.map((i) => i.id));
  return splitStrategy.layout({ items, container: CONTAINER, state, options: OPTIONS });
}

describe('splitStrategy over the tube lab zone', () => {
  it('places every panel', () => {
    const { placements } = layoutOf(16);

    expect(placements.size).toBe(16);
    for (const rect of placements.values()) {
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    }
  });

  it('never overlaps two panels, which is what lets one scissored draw serve each', () => {
    const rects = [...layoutOf(16).placements.values()];

    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const x = rects[a] as (typeof rects)[number];
        const y = rects[b] as (typeof rects)[number];
        const apart = x.x + x.w <= y.x || y.x + y.w <= x.x || x.y + x.h <= y.y || y.y + y.h <= x.y;
        expect(apart, `${JSON.stringify(x)} overlaps ${JSON.stringify(y)}`).toBe(true);
      }
    }
  });

  it('keeps every panel inside the container', () => {
    for (const rect of layoutOf(16).placements.values()) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(CONTAINER.w);
      expect(rect.y + rect.h).toBeLessThanOrEqual(CONTAINER.h);
    }
  });

  it('offers a gutter per split, which is what the resize affordance renders', () => {
    expect(layoutOf(16).affordances.length).toBeGreaterThan(0);
  });

  it('tiles evenly rather than halving each pane in turn', () => {
    // Not only at 16: at a power of two `mid / ids.length` is 0.5 at every level, so a hardcoded
    // ratio is indistinguishable there.
    for (const count of [3, 7, 16]) {
      const areas = [...layoutOf(count).placements.values()].map((r) => r.w * r.h);
      const min = Math.min(...areas);
      const max = Math.max(...areas);

      // Guard the sign first: the degenerate spine drives panes negative, and a negative `min`
      // makes the ratio pass without meaning anything.
      expect(min, `${count} panels`).toBeGreaterThan(0);
      expect(max / min, `${count} panels`).toBeLessThan(1.5);
    }
  });

  it('lays out a grid, not a row of stripes', () => {
    const rects = [...layoutOf(16).placements.values()];

    expect(new Set(rects.map((r) => Math.round(r.x))).size).toBe(4);
    expect(new Set(rects.map((r) => Math.round(r.y))).size).toBe(4);
  });
});
