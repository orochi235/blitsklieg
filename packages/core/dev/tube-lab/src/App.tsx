import { useCallback, useEffect, useState } from 'react';
import { asNodeId, createPanel, type NodeId, type SplitNode, type Store } from 'windease';
import { type ChromeArgs, Container, DragHandle, useStore } from 'windease/react';
import type { TubeSpec } from '../../../src/render/tube/index.js';
import {
  isPanelMode,
  isRampSource,
  type PanelMeta,
  type PanelRecord,
  reconcileLetters,
} from './panels.js';
import { clear, save } from './persist.js';
import { balancedTree, withLeaf, withoutLeaf } from './tree.js';

export const ZONE = asNodeId('zone');

export function metaOf(raw: Record<string, unknown> | undefined): PanelMeta {
  const letter = typeof raw?.letter === 'string' ? raw.letter : '?';
  const mode = isPanelMode(raw?.mode) ? raw.mode : 'beauty';
  const source = isRampSource(raw?.source) ? raw.source : 'depth';
  return { letter, mode, source };
}

function createPanelNode(id: NodeId, meta: PanelMeta) {
  return createPanel({ id, parentId: ZONE, meta: { ...meta } });
}

function addPanel(store: Store, meta: PanelMeta): NodeId {
  const taken = new Set<string>(store.getChildren(ZONE).map((node) => node.id));
  let n = 0;
  while (taken.has(`p${n}`)) n++;
  const id = asNodeId(`p${n}`);
  store.registerNode(createPanelNode(id, meta));
  store.showNode(id);
  return id;
}

function chrome({ node }: ChromeArgs) {
  const meta = metaOf(node.meta);
  return (
    <div className="panel">
      <DragHandle nodeId={node.id}>
        <div className="panel__bar">
          <span className="panel__letter">{meta.letter}</span>
          <span className="panel__mode">{meta.mode}</span>
        </div>
      </DragHandle>
      <div className="panel__body" />
    </div>
  );
}

export interface AppProps {
  letters: string;
  spec: TubeSpec;
}

export function App({ letters: initialLetters, spec }: AppProps) {
  const store = useStore();
  const [letters, setLetters] = useState(initialLetters);

  const panels = useCallback((): PanelRecord[] => {
    return store.getChildren(ZONE).map((node) => ({ id: node.id, ...metaOf(node.meta) }));
  }, [store]);

  const applyLetters = useCallback(
    (next: string) => {
      setLetters(next);
      const { add, remove } = reconcileLetters(panels(), next);
      // The store and the tree move together: a panel missing from the tree is silently not laid
      // out, and a leaf left behind holds space no panel is using.
      let tree = store.getContainerState(ZONE) as SplitNode;
      for (const id of remove) {
        store.unregisterNode(id as NodeId);
        tree = withoutLeaf(tree, id);
      }
      // Emptying the field strands the tree on ids that no longer exist, so a refill starts over.
      const refilling = store.getChildren(ZONE).length === 0;
      const added = add.map((meta) => addPanel(store, meta));
      tree = refilling ? balancedTree(added) : added.reduce((t, id) => withLeaf(t, id), tree);
      if (store.getChildren(ZONE).length > 0) store.setContainerState(ZONE, tree);
    },
    [panels, store],
  );

  useEffect(() => {
    let frame = 0;
    const flush = () => {
      frame = 0;
      save(store, letters, spec);
    };
    save(store, letters, spec);
    // A gutter drag never changes `letters` or `spec`, so the store itself has to say when to save.
    const unsubscribe = store.subscribe(() => {
      if (!frame) frame = requestAnimationFrame(flush);
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [store, letters, spec]);

  return (
    <div className="lab">
      <div className="stage">
        <Container className="zone" parentId={ZONE} chrome={chrome} affordances />
      </div>
      <div className="rail">
        <section className="rail__group">
          <h2>zone</h2>
          <label>
            letters
            <input value={letters} onChange={(e) => applyLetters(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => {
              clear();
              location.reload();
            }}
          >
            reset layout
          </button>
        </section>
      </div>
    </div>
  );
}
