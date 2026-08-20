import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { asNodeId, createPanel, type NodeId, type SplitNode, type Store } from 'windease';
import {
  type ChromeArgs,
  Container,
  DragHandle,
  useContainerLayout,
  useStore,
} from 'windease/react';
import { specOf } from '../../../src/render/looks.js';
import type { TubeSpec } from '../../../src/render/tube/index.js';
import type { LoadedFont } from '../../../src/text/font.js';
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '../../../src/text/glyphs.js';
import { labFont } from './font.js';
import {
  isPanelMode,
  isRampSource,
  type PanelMeta,
  type PanelRecord,
  RAMP_SOURCES,
  reconcileLetters,
} from './panels.js';
import { clear, save } from './persist.js';
import { buildCell, type Cell } from './render/cell.js';
import { LabRenderer, type PanelDraw } from './render/lab.js';
import { rampMaterial } from './render/ramp.js';
import { buildSkeleton } from './render/skeleton.js';
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

/** How an orbit panel is being looked at. In memory only, like the layout is not. */
interface View {
  yaw: number;
  pitch: number;
  zoom: number;
}

const HEAD_ON: View = { yaw: 0, pitch: 0, zoom: 1 };

/** The off-axis baseline's yaw, with enough pitch to show a planar loop ring as an ellipse. */
const ORBIT_SEED: View = { yaw: (30 * Math.PI) / 180, pitch: (13 * Math.PI) / 180, zoom: 1 };

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

/**
 * Wheel and pinch both arrive as `deltaY`, an order of magnitude apart: a mouse notch is ~100,
 * where a trackpad pinch streams a few per event. Divisors of an exponent, so either gesture
 * covers about the same ground: a notch is 1.22x, and a pinch of ~100 accumulated is 2.7x.
 */
const WHEEL_STEP = 500;
const PINCH_STEP = 100;

interface OrbitProps {
  'data-orbit': string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}

function chromeFor(
  store: Store,
  reports: Record<string, string>,
  onChange: () => void,
  orbitProps: (id: string) => OrbitProps,
) {
  return function chrome({ node }: ChromeArgs) {
    const meta = metaOf(node.meta);
    const summary = reports[node.id];
    return (
      <div className="panel">
        <DragHandle nodeId={node.id}>
          <div className="panel__bar">
            <span className="panel__letter">{meta.letter}</span>
            <span className="panel__mode">{meta.mode}</span>
            {meta.mode === 'ramp' ? (
              // stopPropagation, or the enclosing DragHandle reads a click on the select as a drag.
              <select
                value={meta.source}
                onChange={(e) => {
                  store.setMeta(node.id, { source: e.target.value });
                  onChange();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {RAMP_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </DragHandle>
        <div
          className={meta.mode === 'orbit' ? 'panel__body panel__body--orbit' : 'panel__body'}
          {...(meta.mode === 'orbit' ? orbitProps(node.id) : null)}
        >
          {summary ? <p className="panel__readout">{summary}</p> : null}
        </div>
      </div>
    );
  };
}

export interface AppProps {
  letters: string;
  spec: TubeSpec;
}

export function App({ letters: initialLetters, spec }: AppProps) {
  const store = useStore();
  const [letters, setLetters] = useState(initialLetters);
  const [lookName] = useState<'tubing' | 'piping'>('tubing');
  const look = useMemo(() => specOf(lookName), [lookName]);
  const specKey = JSON.stringify(spec) + lookName;

  const panels = useCallback((): PanelRecord[] => {
    return store.getChildren(ZONE).map((node) => ({ id: node.id, ...metaOf(node.meta) }));
  }, [store]);

  const applyLetters = useCallback(
    (next: string) => {
      setLetters(next);
      const { add, remove } = reconcileLetters(panels(), next);
      // The store and the tree move together: a panel missing from the tree is silently not laid
      // out, and a leaf left behind holds space no panel is using.
      const current = store.getContainerState(ZONE);
      if (!current) throw new Error('tube lab: the zone lost its layout tree');
      let tree = current as SplitNode;
      for (const id of remove) {
        store.unregisterNode(asNodeId(id));
        tree = withoutLeaf(tree, id);
      }
      // Read after the removals and before the adds: an emptied zone has nothing to graft onto.
      const refilling = store.getChildren(ZONE).length === 0;
      const added = add.map((meta) => addPanel(store, meta));
      tree = refilling ? balancedTree(added) : added.reduce((t, id) => withLeaf(t, id), tree);
      if (store.getChildren(ZONE).length > 0) store.setContainerState(ZONE, tree);
    },
    [panels, store],
  );

  useEffect(() => {
    let timer = 0;
    const flush = () => {
      timer = 0;
      save(store, letters, spec);
    };
    // Clear before flushing, or the armed timer fires later and writes this closure's stale values.
    const flushPending = () => {
      if (!timer) return;
      clearTimeout(timer);
      flush();
    };
    save(store, letters, spec);
    // A gutter drag never changes `letters` or `spec`, so the store itself has to say when to save.
    const unsubscribe = store.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(flush, 200);
    });
    // A reload does not unmount, so the cleanup alone would drop a drag made inside the window.
    window.addEventListener('pagehide', flushPending);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', flushPending);
      flushPending();
    };
  }, [store, letters, spec]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labRef = useRef<LabRenderer | null>(null);
  const cellsRef = useRef(new Map<string, Cell>());
  const views = useRef(new Map<string, View>());
  const oneFrame = useRef(0);
  const dirty = useRef<string | null>(null);
  const frame = useRef(0);
  const latest = useRef<() => void>(() => {});
  const [font, setFont] = useState<LoadedFont | null>(null);
  const [reports, setReports] = useState<Record<string, string>>({});
  const { placements } = useContainerLayout(ZONE, stageRef);

  const setReport = useCallback((id: string, summary: string) => {
    setReports((prev) => (prev[id] === summary ? prev : { ...prev, [id]: summary }));
  }, []);

  useEffect(() => {
    labFont().then(setFont, (err: unknown) => console.error('tube lab: font failed', err));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The zone does not clip: it carries only the lab's own `zone` class, never windease's
    // `windease-zone`, so that stylesheet's `overflow: hidden` never applies. The canvas is sized
    // to `.stage` instead, and each panel's rect scissors its own draw.
    const lab = new LabRenderer(canvas);
    labRef.current = lab;
    const cells = cellsRef.current;
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      if (oneFrame.current) cancelAnimationFrame(oneFrame.current);
      frame.current = 0;
      oneFrame.current = 0;
      for (const cell of cells.values()) cell.dispose();
      cells.clear();
      lab.dispose();
      labRef.current = null;
    };
  }, []);

  // A tuning tool has no use for an idle 60fps: one draw per change, coalesced into a frame.
  const drawAll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      latest.current();
    });
  }, []);

  // `fit` is absolute, so the view can be re-applied any number of times without compounding.
  const pose = useCallback((cell: Cell, id: string, aspect: number) => {
    const view = views.current.get(id) ?? HEAD_ON;
    cell.pivot.rotation.set(view.pitch, view.yaw, 0);
    cell.fit(aspect, view.zoom);
  }, []);

  // The only draw a gesture runs, and the only one that skips `clear()`: the other fifteen panels
  // are never redrawn, so their pixels have to survive in the framebuffer. The frame reads the
  // panel to draw when it runs, so a burst of events coalesces onto its own newest state.
  const drawOne = useCallback(
    (id: string) => {
      dirty.current = id;
      if (oneFrame.current) return;
      oneFrame.current = requestAnimationFrame(() => {
        oneFrame.current = 0;
        const target = dirty.current;
        dirty.current = null;
        const lab = labRef.current;
        if (!target || !lab) return;
        const cell = cellsRef.current.get(target);
        const rect = placements.get(asNodeId(target));
        if (!cell || !rect) return;
        pose(cell, target, rect.w / rect.h);
        lab.draw([{ rect, scene: cell.scene, camera: cell.camera, bloom: cell.bloom }]);
      });
    },
    [placements, pose],
  );

  const orbitProps = useCallback(
    (id: string): OrbitProps => ({
      'data-orbit': id,
      onPointerDown: (event) => {
        // The title bar above is the DragHandle that rearranges panels; a turn must not reach it.
        event.stopPropagation();
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        let last = { x: event.clientX, y: event.clientY };
        const move = (e: PointerEvent) => {
          const view = views.current.get(id) ?? HEAD_ON;
          // A half turn across the panel's own width, so the gesture scales with the panel.
          const span = Math.max(1, target.clientWidth);
          views.current.set(id, {
            ...view,
            yaw: view.yaw + ((e.clientX - last.x) / span) * Math.PI,
            pitch: view.pitch + ((e.clientY - last.y) / span) * Math.PI,
          });
          last = { x: e.clientX, y: e.clientY };
          drawOne(id);
        };
        const up = () => {
          if (target.hasPointerCapture(event.pointerId))
            target.releasePointerCapture(event.pointerId);
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      },
      onDoubleClick: () => {
        views.current.set(id, ORBIT_SEED);
        drawOne(id);
      },
    }),
    [drawOne],
  );

  // React attaches wheel passively at its root, where preventDefault does nothing and a trackpad
  // pinch zooms the whole page instead of the letter. Hence a listener of our own on the stage.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      const id = (event.target as Element | null)
        ?.closest('[data-orbit]')
        ?.getAttribute('data-orbit');
      if (!id) return;
      event.preventDefault();
      const view = views.current.get(id) ?? HEAD_ON;
      // ctrlKey is how a macOS trackpad pinch reaches the page.
      const step = event.ctrlKey ? PINCH_STEP : WHEEL_STEP;
      const zoom = view.zoom * Math.exp(-event.deltaY / step);
      views.current.set(id, { ...view, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) });
      drawOne(id);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [drawOne]);

  const chromeWithReports = useMemo(
    () => chromeFor(store, reports, drawAll, orbitProps),
    [store, reports, drawAll, orbitProps],
  );

  // The frame calls the newest body, never the one that queued it: coalescing on the call would
  // drop the later layout and leave the canvas at rects nothing reschedules.
  useEffect(() => {
    latest.current = () => {
      const lab = labRef.current;
      const stage = stageRef.current;
      if (!lab || !stage || !font) return;
      lab.resize(stage.clientWidth, stage.clientHeight);
      lab.clear();

      const draws: PanelDraw[] = [];
      const live = new Set<string>();
      for (const [id, rect] of placements) {
        const node = store.getNode(id);
        if (!node) continue;
        const meta = metaOf(node.meta);
        const key = `${id}|${meta.mode}|${meta.letter}|${meta.source}|${specKey}`;
        live.add(id);
        let cell = cellsRef.current.get(id);
        if (!cell || cell.key !== key) {
          cell?.dispose();
          if (meta.mode === 'skeleton') {
            const shapes = glyphToShapes(font.font, meta.letter, 1);
            const skeleton = buildSkeleton(shapes, spec, DEFAULT_GLYPH_OPTIONS.depth);
            cell = buildCell({
              meta,
              look: { ...look, decoration: spec },
              font,
              environment: lab.environmentTexture,
              content: skeleton.object,
            });
            const inner = cell.dispose;
            cell.dispose = () => {
              inner();
              skeleton.dispose();
            };
            setReport(id, skeleton.report.summary);
          } else {
            cell = buildCell({
              meta,
              look: { ...look, decoration: spec },
              font,
              environment: lab.environmentTexture,
              ...(meta.mode === 'ramp' ? { tubeMaterial: () => rampMaterial(meta.source) } : null),
            });
            setReport(id, '');
          }
          cell.key = key;
          cellsRef.current.set(id, cell);
        }
        if (meta.mode === 'orbit' && !views.current.has(id)) views.current.set(id, ORBIT_SEED);
        pose(cell, id, rect.w / rect.h);
        draws.push({ rect, scene: cell.scene, camera: cell.camera, bloom: cell.bloom });
      }
      for (const [id, cell] of cellsRef.current) {
        if (live.has(id)) continue;
        cell.dispose();
        cellsRef.current.delete(id);
        views.current.delete(id);
        setReport(id, '');
      }
      lab.draw(draws);
    };
    drawAll();
  }, [drawAll, font, placements, spec, specKey, look, store, setReport, pose]);

  return (
    <div className="lab">
      <div className="stage" ref={stageRef}>
        <canvas ref={canvasRef} />
        <Container className="zone" parentId={ZONE} chrome={chromeWithReports} affordances />
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
