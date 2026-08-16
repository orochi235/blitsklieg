import * as THREE from 'three';
import { blankPose, type Timeline } from '../motion/compositor.js';
import type { LoadedFont } from '../text/font.js';
import { buildGlyphGeometry, DEFAULT_GLYPH_OPTIONS, GlyphCache } from '../text/glyphs.js';
import type { Budget, Line } from '../text/layout.js';
import { fitScale, LINE_HEIGHT_EM, layoutBlock, wrapBlock } from '../text/layout.js';
import { applyLook, createMaterial, type LookName } from './looks.js';

const EM = 1; // glyphs are built at 1 em; the group scale does the fitting

/** One mesh per letter — per-letter motion (spin, flip, shatter) needs independent transforms. */
export class Word {
  readonly group = new THREE.Group();
  /** null where the glyph drew no outline (space, U+00A0, ZWJ); the slot still holds its index. */
  private readonly letters: (THREE.Mesh | null)[] = [];
  /** Layout x per letter. Pose x is an OFFSET onto this — overwriting it collapses the word. */
  private readonly baseX: number[] = [];
  /** Layout y per letter, for the same reason: pose y adds onto it, or the lines stack up. */
  private readonly baseY: number[] = [];
  private readonly lineOf: number[] = [];
  private readonly columnOf: number[] = [];
  readonly lineCount: number;
  private readonly columnCount: number;
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly cache: GlyphCache;
  private readonly pose = blankPose();
  private disposed = false;

  constructor(
    text: string,
    font: LoadedFont,
    look: LookName,
    budget: Budget,
    wrap = false,
    tint?: number,
  ) {
    this.material = createMaterial();
    applyLook(this.material, look, tint);
    // Enters and exits animate opacity, and flipping this mid-run would recompile the shader.
    this.material.transparent = true;
    this.cache = new GlyphCache((char, depth) =>
      buildGlyphGeometry(font.font, char, EM, { ...DEFAULT_GLYPH_OPTIONS, depth }),
    );

    const scaleToEm = EM / font.unitsPerEm;
    const block = wrap
      ? wrapBlock(text, font.metrics, budget, font.unitsPerEm)
      : layoutBlock(text, font.metrics);

    this.lineCount = block.lines.length;
    this.columnCount = Math.max(0, ...block.lines.map((l) => l.glyphs.length));

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;

    for (let ln = 0; ln < block.lines.length; ln++) {
      const line = block.lines[ln] as Line;
      const y = -ln * LINE_HEIGHT_EM;
      const first = this.letters.length;
      let inkStart: number | null = null;
      let inkEnd = 0;

      for (const g of line.glyphs) {
        const x = g.x * scaleToEm;
        this.baseX.push(x);
        this.baseY.push(y);
        this.lineOf.push(ln);
        this.columnOf.push(g.index);

        const geo = this.cache.get(g.char, DEFAULT_GLYPH_OPTIONS.depth);
        if (!geo.attributes.position?.count) {
          this.letters.push(null);
          continue;
        }

        const mesh = new THREE.Mesh(geo, this.material);
        this.letters.push(mesh);
        this.group.add(mesh);

        const bounds = geo.boundingBox;
        if (bounds) {
          minY = Math.min(minY, y + bounds.min.y);
          maxY = Math.max(maxY, y + bounds.max.y);
        }
        inkStart ??= x;
        inkEnd = x + font.metrics.advanceOf(g.char) * scaleToEm;
      }

      // Each line centers on x=0 independently. Spanning the drawn glyphs rather than
      // line.width keeps a trailing space from pushing the line off center.
      const shift = inkStart === null ? 0 : -(inkStart + inkEnd) / 2;
      for (let i = first; i < this.baseX.length; i++) {
        const x = (this.baseX[i] as number) + shift;
        this.baseX[i] = x;
        const mesh = this.letters[i];
        if (mesh) mesh.position.set(x, y, 0);
      }
      if (inkStart !== null) {
        minX = Math.min(minX, inkStart + shift);
        maxX = Math.max(maxX, inkEnd + shift);
      }
    }

    const drawn = Number.isFinite(minY);
    // Ink height, not cap height: a descender both drops the center and eats budget.
    const midY = drawn ? (minY + maxY) / 2 : 0;
    const width = Number.isFinite(minX) ? maxX - minX : 0;
    const scale = fitScale(width, drawn ? maxY - minY : 0, budget);
    this.group.scale.setScalar(scale);
    // Lines are already centered on x, so only the block's vertical midpoint needs correcting.
    this.group.position.set(0, -midY * scale, 0);
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

      // One scratch pose for the whole word; this loop runs per letter per frame. LetterInfo is
      // still fresh each time — a caller-supplied piece receives it, and a reused one would be
      // an aliasing trap with nothing in the signature to warn about it.
      const pose = timeline.poseAt(
        elapsed,
        {
          index: i,
          count: this.letters.length,
          line: this.lineOf[i] as number,
          column: this.columnOf[i] as number,
          lineCount: this.lineCount,
          columnCount: this.columnCount,
        },
        this.pose,
      );
      mesh.position.x = (this.baseX[i] as number) + pose.position[0];
      mesh.position.y = (this.baseY[i] as number) + pose.position[1];
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
