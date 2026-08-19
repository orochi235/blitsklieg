import type { Look, Transform } from 'blitsklieg';
import * as THREE from 'three';
// Diagnostics reach past the published `blitsklieg` entry into core's source directly, the same
// way vite.config.ts already does for the whole package — see packages/core/src/debug.ts for why
// this can't be a normal import: Word owns per-letter layout and the tube pipeline, and there is
// no public hook to intercept either without duplicating them here.
import {
  type LoadedFont,
  loadFont,
  NONE,
  Stage,
  surfacesOf,
  Timeline,
  Word,
  type WordDebugHooks,
} from '../../../packages/core/src/debug.js';

// A "none" motion at elapsed 0 is the rest pose (full opacity, no offset) — apply() still has to
// run once, since Word starts every material at THREE's default opacity of 1 until it does,
// which would render tubing's 0.08 backing as a solid wall instead of a near-invisible one.
const REST_TIMELINE = new Timeline({ enter: NONE, active: NONE, exit: NONE, hold: 0, blendMs: 0 });

export type DiagnosticMode = 'off' | 'depth' | 'arc';

/** Comfortably brackets the glyph extrude depth (0.3 em) plus wander/amplitude margin. */
const DEPTH_RANGE: [number, number] = [-0.1, 0.4];

const VERTEX_SHADER = `
  varying float vArc;
  varying float vDepth;
  void main() {
    vArc = uv.x;
    vDepth = position.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// One ramp, luminance-increasing indigo -> blue -> teal -> yellow, so depth and arc-length modes
// read the same way and stay legible under red-green color blindness.
const FRAGMENT_SHADER = `
  precision highp float;
  varying float vArc;
  varying float vDepth;
  uniform float uMode;
  uniform float uDepthMin;
  uniform float uDepthMax;

  vec3 ramp(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c0 = vec3(0.03, 0.03, 0.12);
    vec3 c1 = vec3(0.16, 0.20, 0.62);
    vec3 c2 = vec3(0.09, 0.62, 0.55);
    vec3 c3 = vec3(0.99, 0.93, 0.35);
    if (t < 0.333) return mix(c0, c1, t / 0.333);
    if (t < 0.666) return mix(c1, c2, (t - 0.333) / 0.333);
    return mix(c2, c3, (t - 0.666) / 0.334);
  }

  void main() {
    float depthT = clamp((vDepth - uDepthMin) / (uDepthMax - uDepthMin), 0.0, 1.0);
    gl_FragColor = vec4(ramp(uMode > 0.5 ? vArc : depthT), 1.0);
  }
`;

/** One shader, one ramp; `mode` only picks which baked scalar (uv.x or position.z) it reads. */
function debugMaterial(mode: 'depth' | 'arc'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uMode: { value: mode === 'arc' ? 1 : 0 },
      uDepthMin: { value: DEPTH_RANGE[0] },
      uDepthMax: { value: DEPTH_RANGE[1] },
    },
  });
}

const OUTLINE_MATERIAL = new THREE.LineBasicMaterial({ color: 0xffffff });

/**
 * The front and back rings from `surfacesOf()` — the same polygons the distance field rasterises
 * — not a re-derived outline, so a run that looks misplaced against it genuinely is.
 */
function outlineGroup(shapes: THREE.Shape[], depth: number): THREE.Group {
  const group = new THREE.Group();
  for (const surface of surfacesOf(shapes, depth)) {
    if (surface.kind !== 'wall') continue;
    for (const z of [0, surface.depth]) {
      const points = surface.ring.map((p) => new THREE.Vector3(p.x, p.y, z));
      group.add(
        new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), OUTLINE_MATERIAL),
      );
    }
  }
  return group;
}

/**
 * A static, non-animated stand-in for the real `fire()` pipeline. Diagnostics only need one
 * settled frame, so this skips the motion timeline, queue and bloom compositing entirely rather
 * than threading a debug hook through them — the tube pipeline itself (the thing being
 * diagnosed) is still the real `Word`/`surfacesOf`, so nothing here can disagree with it.
 */
export class DiagnosticStage {
  private readonly stage = new Stage({ idleTimeoutMs: 8000 });
  private fontPromise: Promise<LoadedFont> | null = null;
  private word: Word | null = null;

  constructor(private readonly fontUrl: string) {}

  private font(): Promise<LoadedFont> {
    this.fontPromise ??= loadFont(this.fontUrl);
    return this.fontPromise;
  }

  async render(
    text: string,
    look: Look,
    transform: Transform,
    mode: DiagnosticMode,
    outlines: boolean,
  ): Promise<void> {
    const font = await this.font();
    const renderer = this.stage.mount();

    const hooks: WordDebugHooks = {};
    if (mode !== 'off') hooks.tubeMaterial = () => debugMaterial(mode);
    if (outlines) hooks.onLetter = (cell, shapes, depth) => cell.add(outlineGroup(shapes, depth));

    if (this.word) {
      this.stage.scene.remove(this.word.group);
      this.word.dispose();
    }
    const word = new Word(text, font, look, this.stage.viewportBudget(), false, undefined, hooks);
    word.transform = transform;
    word.apply(REST_TIMELINE, 0);
    this.stage.scene.add(word.group);
    this.word = word;

    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(this.stage.scene, this.stage.camera);
  }

  hide(): void {
    if (this.word) {
      this.stage.scene.remove(this.word.group);
      this.word.dispose();
      this.word = null;
    }
    this.stage.unmount();
  }
}
