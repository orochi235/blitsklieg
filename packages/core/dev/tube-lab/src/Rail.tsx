import { useCallback, useEffect, useRef, useState } from 'react';
import type { SurfaceKind, TubeSpec } from '../../../src/render/tube/index.js';
import { lettersOf, MODES, type PanelMode } from './panels.js';
import { TUBE_LOOKS, type TubeLook } from './spec.js';

/** The spec fields a slider drives. Every one of them is a number in `TubeSpec`. */
type NumberKey =
  | 'radius'
  | 'bend'
  | 'segments'
  | 'spacing'
  | 'level'
  | 'runs'
  | 'minRun'
  | 'amplitude'
  | 'wallDepth'
  | 'wallRise';

/** Sliders are integers; `scale` is what divides one back into the spec's own units. */
interface NumberField {
  key: NumberKey;
  label: string;
  min: number;
  max: number;
  step: number;
  scale: number;
  /** What the builder uses when the spec omits the field, which is what the slider must read. */
  unset?: number;
}

const TUBE_FIELDS: NumberField[] = [
  { key: 'radius', label: 'radius', min: 1, max: 120, step: 1, scale: 1000 },
  // Floored at 1.25 in bend.ts whatever the slider says. Watch the skeleton panel's rejected-fillet
  // count rather than its corner count: bend sets setback, and barely moves classification at all.
  { key: 'bend', label: 'bend', min: 125, max: 400, step: 5, scale: 100, unset: 2 },
  { key: 'segments', label: 'segments', min: 3, max: 32, step: 1, scale: 1 },
  { key: 'spacing', label: 'spacing', min: 2, max: 80, step: 1, scale: 1000 },
  { key: 'level', label: 'level', min: -120, max: 120, step: 1, scale: 1000 },
  { key: 'runs', label: 'runs', min: 1, max: 24, step: 1, scale: 1 },
  { key: 'minRun', label: 'min run', min: 0, max: 300, step: 5, scale: 1000 },
  { key: 'amplitude', label: 'amplitude', min: 0, max: 80, step: 1, scale: 1000 },
  { key: 'wallDepth', label: 'wall depth', min: 0, max: 100, step: 1, scale: 100, unset: 0.5 },
  { key: 'wallRise', label: 'wall rise', min: 0, max: 100, step: 1, scale: 100 },
];

/** The three kinds `surfacesOf` actually produces; `connector` is a count, not a surface. */
const SURFACE_KINDS: SurfaceKind[] = ['front', 'back', 'wall'];

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function unhex(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}

interface Deferred<T> {
  /** What the control displays: the draft while it is being dragged, the spec's own value after. */
  shown: T;
  edit(next: T): void;
  commit(): void;
}

/**
 * A control whose value reaches the spec on release rather than on every input event. One spec
 * change rebuilds all sixteen cells, so writing through per input turns a drag into a lockup.
 */
function useDeferred<T>(value: T, onCommit: (next: T) => void): Deferred<T> {
  const [draft, setDraft] = useState<T | null>(null);
  const [seen, setSeen] = useState(value);
  const pending = useRef<T | null>(null);
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };

  // A value from elsewhere — the look picker reseeding every field — outranks a draft, which would
  // otherwise leave the control reading as the old look's number.
  if (seen !== value) {
    setSeen(value);
    setDraft(null);
    pending.current = null;
  }

  const commit = useCallback(() => {
    const next = pending.current;
    pending.current = null;
    setDraft(null);
    if (next !== null && next !== latest.current.value) latest.current.onCommit(next);
  }, []);

  return {
    shown: draft ?? value,
    edit(next: T) {
      pending.current = next;
      setDraft(next);
    },
    commit,
  };
}

interface RangeProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onCommit: (next: number) => void;
}

function Range({ label, min, max, step, value, disabled, onCommit }: RangeProps) {
  const { shown, edit, commit } = useDeferred(value, onCommit);
  return (
    <label>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        onChange={(e) => edit(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}

interface ColorProps {
  label: string;
  value: number;
  onCommit: (next: number) => void;
}

function Color({ label, value, onCommit }: ColorProps) {
  const { shown, edit, commit } = useDeferred(value, onCommit);
  const input = useRef<HTMLInputElement>(null);

  // The picker is a window of its own: no pointer release lands on the input and focus never
  // leaves it, so the native `change` it fires on close is the only commit that arrives.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [commit]);

  return (
    <label>
      {label}
      <input
        ref={input}
        type="color"
        value={hex(shown)}
        onChange={(e) => edit(unhex(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}

export interface RailProps {
  spec: TubeSpec;
  onSpec: (next: TubeSpec) => void;
  look: TubeLook;
  onLook: (next: TubeLook) => void;
  bloom: boolean;
  onBloom: (next: boolean) => void;
  letters: string;
  onLetters: (next: string) => void;
  onAddPanel: (letter: string, mode: PanelMode) => void;
  onReset: () => void;
}

export function Rail(props: RailProps) {
  const { spec, onSpec } = props;
  const corners = spec.corners ?? { break: 1, connect: 0, loop: 0 };
  const patch = (part: Partial<TubeSpec>) => onSpec({ ...spec, ...part });
  // `generateConnectors` returns nothing without both faces, so the controls say so rather than
  // sitting live and doing nothing.
  const bothFaces = spec.surfaces.includes('front') && spec.surfaces.includes('back');
  const shown = lettersOf(props.letters);
  const [addLetter, setAddLetter] = useState(shown[0] ?? 'M');
  const [addMode, setAddMode] = useState<PanelMode>('beauty');
  // The letters field moves under the select, and adding a letter the zone does not show would
  // put up a panel the next reconcile takes straight back down.
  const adding = shown.includes(addLetter) ? addLetter : (shown[0] ?? addLetter);

  return (
    <div className="rail">
      <section className="rail__group">
        <h2>tube</h2>
        {TUBE_FIELDS.map((field) => (
          <Range
            key={field.key}
            label={field.label}
            min={field.min}
            max={field.max}
            step={field.step}
            value={Math.round((spec[field.key] ?? field.unset ?? 0) * field.scale)}
            onCommit={(next) => onSpec({ ...spec, [field.key]: next / field.scale })}
          />
        ))}
        <Range
          label="lit"
          min={0}
          max={100}
          step={1}
          value={Math.round(spec.select.amount * 100)}
          onCommit={(next) => patch({ select: { ...spec.select, amount: next / 100 } })}
        />
      </section>

      <section className="rail__group">
        <h2>corners</h2>
        {(['break', 'connect', 'loop'] as const).map((kind) => (
          <Range
            key={kind}
            label={kind}
            min={0}
            max={100}
            step={1}
            value={Math.round(corners[kind] * 100)}
            onCommit={(next) => patch({ corners: { ...corners, [kind]: next / 100 } })}
          />
        ))}
      </section>

      <section className="rail__group">
        <h2>surfaces</h2>
        {SURFACE_KINDS.map((kind) => (
          <label key={kind}>
            {kind}
            <input
              type="checkbox"
              checked={spec.surfaces.includes(kind)}
              onChange={(e) =>
                patch({
                  // Rebuilt in the canonical order, so checking a box back on cannot reshuffle
                  // the list and rebuild every cell for nothing.
                  surfaces: SURFACE_KINDS.filter((s) =>
                    s === kind ? e.target.checked : spec.surfaces.includes(s),
                  ),
                })
              }
            />
          </label>
        ))}
        <Range
          label="connectors"
          min={0}
          max={8}
          step={1}
          value={spec.connectors ?? 0}
          disabled={!bothFaces}
          onCommit={(next) => patch({ connectors: next })}
        />
        <Range
          label="overshoot"
          min={0}
          max={200}
          step={1}
          value={Math.round((spec.connectorOvershoot ?? 0.05) * 1000)}
          disabled={!bothFaces}
          onCommit={(next) => patch({ connectorOvershoot: next / 1000 })}
        />
        {bothFaces ? null : <p className="rail__note">connectors need front and back</p>}
      </section>

      <section className="rail__group">
        <h2>material</h2>
        <Color
          label="emissive"
          value={spec.look.emissive ?? 0xffffff}
          onCommit={(next) => patch({ look: { ...spec.look, emissive: next } })}
        />
        <Range
          label="intensity"
          min={0}
          max={100}
          step={1}
          value={Math.round((spec.look.emissiveIntensity ?? 0) * 10)}
          onCommit={(next) => patch({ look: { ...spec.look, emissiveIntensity: next / 10 } })}
        />
        <Color
          label="run colour"
          value={spec.colors[0] ?? 0xffffff}
          onCommit={(next) => patch({ colors: [next] })}
        />
        <label>
          bloom
          <input
            type="checkbox"
            checked={props.bloom}
            onChange={(e) => props.onBloom(e.target.checked)}
          />
        </label>
      </section>

      <section className="rail__group">
        <h2>zone</h2>
        <label>
          look
          <select value={props.look} onChange={(e) => props.onLook(e.target.value as TubeLook)}>
            {TUBE_LOOKS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          letters
          <input value={props.letters} onChange={(e) => props.onLetters(e.target.value)} />
        </label>
        <label>
          add
          <select value={adding} onChange={(e) => setAddLetter(e.target.value)}>
            {shown.map((letter) => (
              <option key={letter} value={letter}>
                {letter}
              </option>
            ))}
          </select>
        </label>
        <label>
          as
          <select value={addMode} onChange={(e) => setAddMode(e.target.value as PanelMode)}>
            {MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => props.onAddPanel(adding, addMode)}>
          add panel
        </button>
        <button type="button" onClick={props.onReset}>
          reset layout
        </button>
      </section>
    </div>
  );
}
