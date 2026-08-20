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

/** The shallowest leaf — in a balanced tree, the largest pane, so additions stay even. */
function largestLeaf(tree: SplitNode, depth = 0): { id: string; depth: number } {
  if (tree.kind === 'leaf') return { id: tree.id, depth };
  const a = largestLeaf(tree.a, depth + 1);
  const b = largestLeaf(tree.b, depth + 1);
  return b.depth < a.depth ? b : a;
}

/** Splits the largest pane in two and puts `id` in the new half; every other ratio is untouched. */
export function withLeaf(tree: SplitNode, id: string): SplitNode {
  const host = largestLeaf(tree).id;
  const graft = (node: SplitNode, direction: Direction): SplitNode => {
    if (node.kind === 'leaf') {
      if (node.id !== host) return node;
      return { kind: 'split', direction, ratio: 0.5, a: node, b: { kind: 'leaf', id } };
    }
    const next: Direction = node.direction === 'horizontal' ? 'vertical' : 'horizontal';
    return { ...node, a: graft(node.a, next), b: graft(node.b, next) };
  };
  return graft(tree, 'horizontal');
}

/** Collapses the split that held `id` down to its sibling, which takes the freed space. */
export function withoutLeaf(tree: SplitNode, id: string): SplitNode {
  if (tree.kind === 'leaf') return tree;
  if (tree.a.kind === 'leaf' && tree.a.id === id) return withoutLeaf(tree.b, id);
  if (tree.b.kind === 'leaf' && tree.b.id === id) return withoutLeaf(tree.a, id);
  return { ...tree, a: withoutLeaf(tree.a, id), b: withoutLeaf(tree.b, id) };
}
