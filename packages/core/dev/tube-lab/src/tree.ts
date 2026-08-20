import type { SplitNode } from 'windease';

type Direction = 'horizontal' | 'vertical';

/**
 * A balanced tree over `ids`, alternating direction by depth so the panels tile a grid, each split
 * in proportion to the leaves it carries. windease 0.8's own `initialState` halves each pane in
 * turn instead; this goes away when `splitStrategy` is replaced by a `split(zoneId, …)` store
 * operation.
 */
export function balancedTree(
  ids: readonly string[],
  direction: Direction = 'horizontal',
): SplitNode {
  if (ids.length <= 1) return { kind: 'leaf', id: ids[0] ?? '' };
  const mid = Math.ceil(ids.length / 2);
  const next: Direction = direction === 'horizontal' ? 'vertical' : 'horizontal';
  return {
    kind: 'split',
    direction,
    ratio: mid / ids.length,
    a: balancedTree(ids.slice(0, mid), next),
    b: balancedTree(ids.slice(mid), next),
  };
}
