import { createRoot } from 'react-dom/client';
import { asNodeId, createPanel, createZone, type NodeId, Store, splitStrategy } from 'windease';
import { DragProvider, Provider, StrategyRegistryProvider } from 'windease/react';
import 'windease/styles.css';
import { specOf } from '../../../src/render/looks.js';
import type { TubeSpec } from '../../../src/render/tube/index.js';
import { App, ZONE } from './App.js';
import { DEFAULT_LETTERS, seedPanels } from './panels.js';
import { restore } from './persist.js';
import './styles.css';
import { balancedTree } from './tree.js';

function tubeSpecOf(name: 'tubing' | 'piping'): TubeSpec {
  const decoration = specOf(name).decoration;
  if (decoration?.kind !== 'tube') throw new Error(`tube lab: ${name} has no tube decoration`);
  return decoration;
}

function seed(store: Store): void {
  store.registerNode(
    createZone({ id: ZONE, strategyId: 'split', config: { recursive: true, gutterSize: 6 } }),
  );
  store.showNode(ZONE);

  const ids: NodeId[] = [];
  let counter = 0;
  for (const meta of seedPanels(DEFAULT_LETTERS)) {
    const id = asNodeId(`p${counter++}`);
    store.registerNode(createPanel({ id, parentId: ZONE, meta: { ...meta } }));
    store.showNode(id);
    ids.push(id);
  }
  store.setContainerState(ZONE, balancedTree(ids));
}

const store = new Store();
const saved = restore(store);
if (!saved) seed(store);

const host = document.getElementById('root');
if (!host) throw new Error('tube lab: the page has no #root');

createRoot(host).render(
  <Provider store={store}>
    <StrategyRegistryProvider strategies={{ split: splitStrategy }}>
      <DragProvider>
        <App
          letters={saved?.letters ?? DEFAULT_LETTERS}
          spec={saved?.spec ?? tubeSpecOf('tubing')}
        />
      </DragProvider>
    </StrategyRegistryProvider>
  </Provider>,
);
