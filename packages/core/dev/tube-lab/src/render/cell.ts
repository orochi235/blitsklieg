import * as THREE from 'three';
import { Timeline } from '../../../../src/motion/compositor.js';
import { NONE } from '../../../../src/motion/types.js';
import type { LookSpec } from '../../../../src/render/looks.js';
import { Word } from '../../../../src/render/word.js';
import type { LoadedFont } from '../../../../src/text/font.js';
import type { PanelMeta } from '../panels.js';

const FOV = 38;
const DISTANCE = 11;

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
  const extent = 2 * Math.tan((FOV * Math.PI) / 360) * DISTANCE * 0.8;
  return { width: extent, height: extent };
}

export interface Cell {
  /** What this cell was built from; a change to it is what makes the cell stale. */
  key: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Yawed and pitched by orbit. Never the camera: the fit reads `camera.position.z`. */
  pivot: THREE.Group;
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
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, DISTANCE);
  const pivot = new THREE.Group();
  scene.add(pivot);

  if (input.content) {
    pivot.add(input.content);
    return {
      key: '',
      scene,
      camera,
      pivot,
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
    bloom: input.look.bloom ?? false,
    dispose() {
      pivot.remove(word.group);
      word.dispose();
    },
  };
}
