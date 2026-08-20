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
    const areas = [...layoutOf(16).placements.values()].map((r) => r.w * r.h);
    const min = Math.min(...areas);
    const max = Math.max(...areas);

    // The degenerate spine `splitStrategy.initialState` builds spans a factor of 2^15 here, so
    // this is what fails if anyone swaps the lab's tree back for it.
    expect(max / min).toBeLessThan(1.5);
  });
});
