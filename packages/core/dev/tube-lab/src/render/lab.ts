import * as THREE from 'three';
import { BloomPath } from '../../../../src/render/bloom.js';
import { buildEnvironment } from '../../../../src/render/environment.js';

export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelDraw {
  rect: PanelRect;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  bloom: boolean;
}

export class LabRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly bloom: BloomPath;
  private readonly environment: THREE.WebGLRenderTarget;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer because a redraw here is one dirty panel, not the whole canvas: the
    // default framebuffer's contents are undefined after the page composites, so the other
    // fifteen panels would go black on every partial draw without it.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x0c0f16, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.environment = buildEnvironment(this.renderer);
    this.bloom = new BloomPath(this.renderer);
  }

  get environmentTexture(): THREE.Texture {
    return this.environment.texture;
  }

  resize(width: number, height: number): void {
    const ratio = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
  }

  /** The gutters lie outside every scissor, so a re-tile strands the old panels' pixels there. */
  clear(): void {
    const r = this.renderer;
    r.setRenderTarget(null);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.clear();
  }

  draw(panels: readonly PanelDraw[]): void {
    const r = this.renderer;
    for (const panel of panels) {
      const { w, h } = panel.rect;
      if (w < 2 || h < 2) continue;
      // Integer device pixels: setViewport rounds where setRenderTarget(null) floors, so a
      // fractional rect can shift a pixel between the scene draw and the composite and leave a
      // hairline seam at the panel border.
      const dpr = r.getPixelRatio();
      const x = Math.round(panel.rect.x * dpr) / dpr;
      // three measures a viewport from the bottom; a windease rect comes from the DOM's top.
      const y = Math.round((this.height - panel.rect.y - h) * dpr) / dpr;
      panel.camera.aspect = w / h;
      panel.camera.updateProjectionMatrix();

      if (panel.bloom) {
        this.bloom.render(panel.scene, panel.camera, { x, y, w, h });
        continue;
      }
      r.setRenderTarget(null);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      r.setScissorTest(true);
      r.clear();
      r.render(panel.scene, panel.camera);
      r.setScissorTest(false);
      r.setViewport(0, 0, this.width, this.height);
    }
  }

  dispose(): void {
    this.bloom.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
