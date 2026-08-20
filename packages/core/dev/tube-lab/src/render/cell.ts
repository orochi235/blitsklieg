import * as THREE from 'three';
import { Timeline } from '../../../../src/motion/compositor.js';
import { NONE } from '../../../../src/motion/types.js';
import type { LookSpec } from '../../../../src/render/looks.js';
import { Word } from '../../../../src/render/word.js';
import type { LoadedFont } from '../../../../src/text/font.js';
import type { PanelMeta } from '../panels.js';

const FOV = 38;
const DISTANCE = 11;

/** Visible height at the word plane. The camera never moves, so it is a constant. */
const VIEW_HEIGHT = 2 * Math.tan((FOV * Math.PI) / 360) * DISTANCE;

/** How much of the panel's smaller side the letter spans. */
export const FILL = 0.72;

/** The lab's fixed view, shared with the fit test so it projects against the same frustum. */
export function labCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, DISTANCE);
  return camera;
}

/**
 * The rest pose. Word starts every material at three's default opacity of 1 until `apply` runs,
 * which renders tubing's 0.08 backing as a solid wall over its own tube.
 */
const REST = new Timeline({ enter: NONE, active: NONE, exit: NONE, hold: 0, blendMs: 0 });

/**
 * A square budget rather than the panel's own aspect: the fit is baked at construction, so
 * reading the live aspect would rebuild every Word on every gutter drag.
 */
function budget(): { width: number; height: number } {
  const extent = VIEW_HEIGHT * 0.8;
  return { width: extent, height: extent };
}

/**
 * Sizes the letter to its panel: `fitScale`'s 2.2 cap is a page effect's fit, a third of the panel
 * and useless for reading tube geometry. Solved at the tube's own plane, a glyph depth in front of
 * the word, because the flat fit overshoots by that plane's magnification and gets scissored.
 */
export function fitter(pivot: THREE.Group): (aspect: number) => void {
  const box = new THREE.Box3().setFromObject(pivot);
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y);
  const front = Math.max(0, box.max.z);
  return (aspect) => {
    if (extent <= 0 || !Number.isFinite(aspect) || aspect <= 0) return;
    const span = FILL * Math.min(1, aspect) * VIEW_HEIGHT;
    pivot.scale.setScalar(span / (extent + (span * front) / DISTANCE));
  };
}

export interface Cell {
  /** What this cell was built from; a change to it is what makes the cell stale. */
  key: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Yawed and pitched by orbit. The camera never moves; the fit is solved against `DISTANCE`. */
  pivot: THREE.Group;
  /** Sizes the letter to the panel it is about to be drawn into, `w / h`. */
  fit(aspect: number): void;
  bloom: boolean;
  dispose(): void;
}

export interface CellInput {
  meta: PanelMeta;
  look: LookSpec;
  font: LoadedFont;
  environment: THREE.Texture;
  /** Whatever the mode wants drawn instead of a Word; `beauty` and `orbit` pass nothing. */
  content?: THREE.Object3D;
}

export function buildCell(input: CellInput): Cell {
  const scene = new THREE.Scene();
  scene.environment = input.environment;
  const camera = labCamera();
  const pivot = new THREE.Group();
  scene.add(pivot);

  if (input.content) {
    pivot.add(input.content);
    return {
      key: '',
      scene,
      camera,
      pivot,
      fit: fitter(pivot),
      bloom: false,
      dispose() {
        pivot.clear();
      },
    };
  }

  const word = new Word(input.meta.letter, input.font, input.look, budget());
  word.apply(REST, 0);
  pivot.add(word.group);

  return {
    key: '',
    scene,
    camera,
    pivot,
    fit: fitter(pivot),
    bloom: input.look.bloom ?? false,
    dispose() {
      pivot.remove(word.group);
      word.dispose();
    },
  };
}
