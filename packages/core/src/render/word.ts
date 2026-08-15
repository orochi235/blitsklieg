import * as THREE from 'three';
import type { Timeline } from '../motion/compositor.js';
import type { LoadedFont } from '../text/font.js';
import { DEFAULT_GLYPH_OPTIONS, GlyphCache, buildGlyphGeometry } from '../text/glyphs.js';
import type { Budget } from '../text/layout.js';
import { fitScale, layoutLine } from '../text/layout.js';
import { type LookName, applyLook, createMaterial } from './looks.js';

const EM = 1; // glyphs are built at 1 em; the group scale does the fitting

/** One mesh per letter — per-letter motion (spin, flip, shatter) needs independent transforms. */
export class Word {
  readonly group = new THREE.Group();
  /** null where the glyph drew no outline (space, U+00A0, ZWJ); the slot still holds its index. */
  private readonly letters: (THREE.Mesh | null)[] = [];
  /** Layout x per letter. Pose x is an OFFSET onto this — overwriting it collapses the word. */
  private readonly baseX: number[] = [];
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly cache: GlyphCache;
  private disposed = false;

  constructor(text: string, font: LoadedFont, look: LookName, budget: Budget) {
    this.material = createMaterial();
    applyLook(this.material, look);
    // Enters and exits animate opacity, and flipping this mid-run would recompile the shader.
    this.material.transparent = true;
    this.cache = new GlyphCache((char, depth) =>
      buildGlyphGeometry(font.font, char, EM, { ...DEFAULT_GLYPH_OPTIONS, depth }),
    );

    const scaleToEm = EM / font.unitsPerEm;
    const line = layoutLine(text, font.metrics);

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let inkStart: number | null = null;
    let inkEnd = 0;

    for (const g of line.glyphs) {
      const x = g.x * scaleToEm;
      this.baseX.push(x);

      const geo = this.cache.get(g.char, DEFAULT_GLYPH_OPTIONS.depth);
      if (!geo.attributes.position?.count) {
        this.letters.push(null);
        continue;
      }

      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.x = x;
      this.letters.push(mesh);
      this.group.add(mesh);

      const bounds = geo.boundingBox;
      if (bounds) {
        minY = Math.min(minY, bounds.min.y);
        maxY = Math.max(maxY, bounds.max.y);
      }
      inkStart ??= x;
      inkEnd = x + font.metrics.advanceOf(g.char) * scaleToEm;
    }

    // Spanning the drawn glyphs, not line.width — its trailing advance would push a word ending
    // in whitespace off center.
    const drawn = Number.isFinite(minY);
    const left = inkStart ?? 0;
    // Ink height, not cap height: a descender both drops the center and eats budget.
    const midY = drawn ? (minY + maxY) / 2 : 0;
    const scale = fitScale(inkEnd - left, drawn ? maxY - minY : 0, budget);
    this.group.scale.setScalar(scale);
    // Center on both axes so rotation pivots through the word, not its left edge.
    this.group.position.set((-(left + inkEnd) / 2) * scale, -midY * scale, 0);
  }

  get letterCount(): number {
    return this.letters.length;
  }

  apply(timeline: Timeline, elapsed: number): void {
    if (this.disposed) return;

    let opacity = 0;
    for (let i = 0; i < this.letters.length; i++) {
      const mesh = this.letters[i];
      if (!mesh) continue;

      const pose = timeline.poseAt(elapsed, { index: i, count: this.letters.length });
      mesh.position.x = (this.baseX[i] as number) + pose.position[0];
      mesh.position.y = pose.position[1];
      mesh.position.z = pose.position[2];
      mesh.rotation.set(...pose.rotation);
      mesh.scale.setScalar(pose.scale);
      opacity = Math.max(opacity, pose.opacity);
    }
    // One shared material. A staggered enter (spin, flip, rise) fades letters in at different
    // times, so taking the last letter's opacity would hide the word until it caught up.
    this.material.opacity = opacity;
  }

  dispose(): void {
    this.disposed = true;
    this.cache.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
