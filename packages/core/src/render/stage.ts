import * as THREE from 'three';
import { buildEnvironment } from './environment.js';

export interface StageOptions {
  /** Resolved at mount, not at construction, so a document-less environment can still get here. */
  target?: HTMLElement;
  /** Idle milliseconds before the WebGL context is torn down. Browsers cap contexts near 16. */
  idleTimeoutMs: number;
}

export function webglSupported(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    // The probe holds a context until GC otherwise, out of the ~16 the whole design budgets for.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  canvas: HTMLCanvasElement | null = null;
  renderer: THREE.WebGLRenderer | null = null;
  environment: THREE.WebGLRenderTarget | null = null;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private detachResize: (() => void) | null = null;

  constructor(private readonly opts: StageOptions) {
    this.camera.position.set(0, 0, 11);
  }

  /** Idempotent: repeated fires reuse one context rather than allocating a new one. */
  mount(): THREE.WebGLRenderer {
    this.cancelIdle();
    if (this.renderer) return this.renderer;

    const canvas = document.createElement('canvas');
    // Inline because a library ships no stylesheet, and host page CSS must not reach the overlay.
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';

    // premultipliedAlpha:false so a straight-alpha composite does not produce bright halos.
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    (this.opts.target ?? document.body).appendChild(canvas);

    this.canvas = canvas;
    this.renderer = renderer;
    this.environment = buildEnvironment(renderer);
    this.scene.environment = this.environment.texture;

    const onResize = () => this.resize();
    globalThis.addEventListener('resize', onResize);
    this.detachResize = () => globalThis.removeEventListener('resize', onResize);
    this.resize();

    return renderer;
  }

  resize(): void {
    if (!this.renderer) return;
    const w = Math.max(1, globalThis.innerWidth);
    const h = Math.max(1, globalThis.innerHeight);
    // Zoom and a move to another display change devicePixelRatio and fire resize; setPixelRatio
    // reallocates the framebuffer, so only pay for it when the ratio actually moved.
    const ratio = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Visible extent at the word's depth, used by fitScale. */
  viewportBudget(widthFrac = 0.62, heightFrac = 0.3): { width: number; height: number } {
    const vh = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.position.z;
    return { width: vh * this.camera.aspect * widthFrac, height: vh * heightFrac };
  }

  scheduleIdleTeardown(): void {
    this.cancelIdle();
    this.idleTimer = setTimeout(() => this.unmount(), this.opts.idleTimeoutMs);
  }

  private cancelIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  unmount(): void {
    this.cancelIdle();
    const { canvas, renderer, environment } = this;
    const detachResize = this.detachResize;
    this.canvas = null;
    this.renderer = null;
    this.environment = null;
    this.detachResize = null;
    this.scene.environment = null;

    try {
      detachResize?.();
      environment?.dispose();
      renderer?.dispose();
    } finally {
      // dispose() drops three's caches but keeps the GL context; only loseContext returns it.
      renderer?.forceContextLoss();
      canvas?.remove();
    }
  }
}
