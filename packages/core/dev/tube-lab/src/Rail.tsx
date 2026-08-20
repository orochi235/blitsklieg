import { useState } from 'react';
import type { SurfaceKind, TubeSpec } from '../../../src/render/tube/index.js';
import { lettersOf, MODES, type PanelMode } from './panels.js';
import { TUBE_LOOKS, type TubeLook } from './spec.js';

/** The spec fields a slider drives. Every one of them is a number in `TubeSpec`. */
type NumberKey =
  | 'radius'
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
  const patchNumber = (key: NumberKey, value: number) => onSpec({ ...spec, [key]: value });
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
          <label key={field.key}>
            {field.label}
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={Math.round((spec[field.key] ?? field.unset ?? 0) * field.scale)}
              onChange={(e) => patchNumber(field.key, Number(e.target.value) / field.scale)}
            />
          </label>
        ))}
        <label>
          lit
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(spec.select.amount * 100)}
            onChange={(e) =>
              patch({ select: { ...spec.select, amount: Number(e.target.value) / 100 } })
            }
          />
        </label>
      </section>

      <section className="rail__group">
        <h2>corners</h2>
        {(['break', 'connect', 'loop'] as const).map((kind) => (
          <label key={kind}>
            {kind}
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(corners[kind] * 100)}
              onChange={(e) =>
                patch({ corners: { ...corners, [kind]: Number(e.target.value) / 100 } })
              }
            />
          </label>
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
        <label>
          connectors
          <input
            type="range"
            min={0}
            max={8}
            step={1}
            value={spec.connectors ?? 0}
            disabled={!bothFaces}
            onChange={(e) => patch({ connectors: Number(e.target.value) })}
          />
        </label>
        <label>
          overshoot
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={Math.round((spec.connectorOvershoot ?? 0.05) * 1000)}
            disabled={!bothFaces}
            onChange={(e) => patch({ connectorOvershoot: Number(e.target.value) / 1000 })}
          />
        </label>
        {bothFaces ? null : <p className="rail__note">connectors need front and back</p>}
      </section>

      <section className="rail__group">
        <h2>material</h2>
        <label>
          emissive
          <input
            type="color"
            value={hex(spec.look.emissive ?? 0xffffff)}
            onChange={(e) => patch({ look: { ...spec.look, emissive: unhex(e.target.value) } })}
          />
        </label>
        <label>
          intensity
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round((spec.look.emissiveIntensity ?? 0) * 10)}
            onChange={(e) =>
              patch({ look: { ...spec.look, emissiveIntensity: Number(e.target.value) / 10 } })
            }
          />
        </label>
        <label>
          run colour
          <input
            type="color"
            value={hex(spec.colors[0] ?? 0xffffff)}
            onChange={(e) => patch({ colors: [unhex(e.target.value)] })}
          />
        </label>
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
