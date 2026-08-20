import { asNodeId } from 'windease';
import { type ChromeArgs, Container, DragHandle } from 'windease/react';
import { isPanelMode, type PanelMeta } from './panels.js';

export const ZONE = asNodeId('zone');

export function metaOf(raw: Record<string, unknown> | undefined): PanelMeta {
  const letter = typeof raw?.letter === 'string' ? raw.letter : '?';
  const mode = isPanelMode(raw?.mode) ? raw.mode : 'beauty';
  const source = raw?.source === 'arc' ? 'arc' : 'depth';
  return { letter, mode, source };
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

export function App() {
  return (
    <div className="lab">
      <div className="stage">
        <Container className="zone" parentId={ZONE} chrome={chrome} affordances />
      </div>
    </div>
  );
}
