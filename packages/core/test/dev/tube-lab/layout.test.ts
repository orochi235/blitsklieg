import { describe, expect, it } from 'vitest';
import { type SplitNode, splitStrategy } from 'windease';
import { balancedTree, withLeaf, withoutLeaf } from '../../../dev/tube-lab/src/tree.js';

const CONTAINER = { w: 1200, h: 800 };
const OPTIONS = { recursive: true, gutterSize: 6 };

function placementsOf(ids: readonly string[], state: SplitNode) {
  const items = ids.map((id) => ({ id }));
  return splitStrategy.layout({ items, container: CONTAINER, state, options: OPTIONS }).placements;
}

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

describe('editing the tree', () => {
  it('places a leaf that arrives, which windease will not do on its own', () => {
    const grown = withLeaf(balancedTree(['a', 'b', 'c', 'd']), 'e');
    const placements = placementsOf(['a', 'b', 'c', 'd', 'e'], grown);

    expect(placements.size).toBe(5);
    for (const rect of placements.values()) expect(rect.w).toBeGreaterThan(0);
  });

  it('splits the largest pane and leaves every other pane untouched', () => {
    // Three leaves sit at depths 2, 2 and 1, so "largest" finally means something.
    const base = balancedTree(['a', 'b', 'c']);
    const before = placementsOf(['a', 'b', 'c'], base);
    const after = placementsOf(['a', 'b', 'c', 'd'], withLeaf(base, 'd'));

    expect(after.get('a')).toEqual(before.get('a'));
    expect(after.get('b')).toEqual(before.get('b'));
    expect(after.get('c')?.h).toBeLessThan(before.get('c')?.h as number);
  });

  it('keeps tiling a grid as leaves arrive rather than shaving stripes off one', () => {
    let grown = balancedTree(['a']);
    for (const id of ['b', 'c', 'd']) grown = withLeaf(grown, id);
    const rects = [...placementsOf(['a', 'b', 'c', 'd'], grown).values()];
    const areas = rects.map((r) => r.w * r.h);

    expect(Math.max(...areas) / Math.min(...areas)).toBeLessThan(1.5);
    expect(new Set(rects.map((r) => Math.round(r.x))).size).toBe(2);
    expect(new Set(rects.map((r) => Math.round(r.y))).size).toBe(2);
  });

  it('hands the removed pane space to its sibling rather than leaving a hole', () => {
    const shrunk = withoutLeaf(balancedTree(['a', 'b', 'c', 'd']), 'c');
    const placements = placementsOf(['a', 'b', 'd'], shrunk);

    const covered = [...placements.values()].reduce((sum, r) => sum + r.w * r.h, 0);
    // Gutters are the only thing the panes do not cover, so 96% is generous but still fails the
    // ~74% a stale tree leaves behind.
    expect(covered).toBeGreaterThan(CONTAINER.w * CONTAINER.h * 0.96);
  });

  it('leaves the ratios a user dragged alone', () => {
    const dragged: SplitNode = { ...balancedTree(['a', 'b']), ratio: 0.8 } as SplitNode;
    const grown = withLeaf(dragged, 'c');

    expect((grown as { ratio: number }).ratio).toBe(0.8);
  });

  it('keeps the ratio a user dragged when a leaf leaves', () => {
    const dragged: SplitNode = { ...balancedTree(['a', 'b', 'c']), ratio: 0.8 } as SplitNode;
    const placements = placementsOf(['a', 'c'], withoutLeaf(dragged, 'b'));
    const a = placements.get('a');
    const c = placements.get('c');

    expect((a as { w: number }).w / ((a as { w: number }).w + (c as { w: number }).w)).toBeCloseTo(
      0.8,
      2,
    );
  });
});
