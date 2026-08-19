import * as THREE from 'three';
import { blankPose, type Timeline } from '../motion/compositor.js';
import type { LoadedFont } from '../text/font.js';
import {
  buildGlyphGeometry,
  DEFAULT_GLYPH_OPTIONS,
  GlyphCache,
  glyphToShapes,
} from '../text/glyphs.js';
import type { Budget, Line } from '../text/layout.js';
import { fitScale, LINE_HEIGHT_EM, layoutBlock, wrapBlock } from '../text/layout.js';
import {
  type Blueprint,
  buildChunkBlueprint,
  buildTubeBlueprint,
  chunkGeometry,
  chunkGeometrySide,
  chunkMatrices,
} from './decoration.js';
import type { FlakeUniforms } from './flake.js';
import { applyLook, createMaterial, type Look, specOf, tintMaterialOf } from './looks.js';

const EM = 1; // glyphs are built at 1 em; the group scale does the fitting

/** One group per letter — per-letter motion (spin, flip, shatter) needs independent transforms. */
export class Word {
  readonly group = new THREE.Group();
  /** null where the glyph drew no outline (space, U+00A0, ZWJ); the slot still holds its index. */
  private readonly letters: (THREE.Group | null)[] = [];
  /** Layout x per letter. Pose x is an OFFSET onto this — overwriting it collapses the word. */
  private readonly baseX: number[] = [];
  /** Layout y per letter, for the same reason: pose y adds onto it, or the lines stack up. */
  private readonly baseY: number[] = [];
  private readonly lineOf: number[] = [];
  private readonly columnOf: number[] = [];
  readonly lineCount: number;
  private readonly columnCount: number;
  /** Indexed by letter slot, null where the glyph drew no outline. */
  private readonly bodyMaterials: (THREE.MeshPhysicalMaterial | null)[] = [];
  private readonly decorMaterials: (THREE.MeshPhysicalMaterial | null)[] = [];
  /** A tube decoration's unlit-run material, one per letter; null for every non-tube letter. */
  private readonly darkMaterials: (THREE.MeshPhysicalMaterial | null)[] = [];
  private readonly cache: GlyphCache;
  private readonly decorCache: GlyphCache<Blueprint> | null;
  private readonly chunkGeo: THREE.BufferGeometry | null;
  private readonly pose = blankPose();
  private readonly bodyOpacity: number;
  private readonly decorOpacity: number;
  /** Base opacity of a tube's unlit runs; irrelevant to every other decoration kind. */
  private readonly darkOpacity: number;
  private disposed = false;

  constructor(
    text: string,
    font: LoadedFont,
    look: Look,
    budget: Budget,
    wrap = false,
    tint?: number,
  ) {
    const spec = specOf(look);
    this.bodyOpacity = spec.opacity ?? 1;

    this.cache = new GlyphCache((char, depth) =>
      buildGlyphGeometry(font.font, char, EM, { ...DEFAULT_GLYPH_OPTIONS, depth }),
    );

    const decoration = spec.decoration;
    this.decorOpacity = decoration?.look.opacity ?? 1;
    this.darkOpacity = decoration?.kind === 'tube' ? (decoration.dark.opacity ?? 1) : 1;
    this.chunkGeo = decoration?.kind === 'chunks' ? chunkGeometry(decoration.shape) : null;
    this.decorCache = decoration
      ? new GlyphCache<Blueprint>((char, depth) =>
          decoration.kind === 'tube'
            ? buildTubeBlueprint(glyphToShapes(font.font, char, EM), decoration, depth, 0)
            : buildChunkBlueprint(this.cache.get(char, depth)),
        )
      : null;

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
          this.bodyMaterials.push(null);
          this.decorMaterials.push(null);
          this.darkMaterials.push(null);
          continue;
        }

        const material = createMaterial();
        applyLook(material, look, tintMaterialOf(spec) === 'body' ? tint : undefined);
        // Enters and exits animate opacity, and flipping this mid-run would recompile the shader.
        material.transparent = true;
        (material.userData.flake as FlakeUniforms).uFlakeSeed.value = this.letters.length * 17.13;
        this.bodyMaterials.push(material);

        const cell = new THREE.Group();
        cell.add(new THREE.Mesh(geo, material));

        if (decoration && this.decorCache) {
          const decorMaterial = createMaterial();
          applyLook(
            decorMaterial,
            decoration.look,
            tintMaterialOf(spec) === 'decoration' ? tint : undefined,
          );
          decorMaterial.transparent = true;
          if (decoration.kind === 'chunks')
            decorMaterial.side = chunkGeometrySide(decoration.shape);
          this.decorMaterials.push(decorMaterial);

          const blueprint = this.decorCache.get(g.char, DEFAULT_GLYPH_OPTIONS.depth);
          let darkMaterial: THREE.MeshPhysicalMaterial | null = null;
          if (blueprint.kind === 'tube' && decoration.kind === 'tube') {
            for (const geo of blueprint.lit) cell.add(new THREE.Mesh(geo, decorMaterial));
            if (blueprint.dark.length > 0) {
              darkMaterial = createMaterial();
              applyLook(darkMaterial, decoration.dark);
              darkMaterial.transparent = true;
              for (const geo of blueprint.dark) cell.add(new THREE.Mesh(geo, darkMaterial));
            }
          } else if (decoration.kind === 'chunks' && blueprint.kind === 'chunks' && this.chunkGeo) {
            const matrices = chunkMatrices(blueprint, decoration, this.letters.length);
            const instanced = new THREE.InstancedMesh(
              this.chunkGeo,
              decorMaterial,
              matrices.length,
            );
            for (let m = 0; m < matrices.length; m++) {
              instanced.setMatrixAt(m, matrices[m] as THREE.Matrix4);
            }
            instanced.instanceMatrix.needsUpdate = true;
            cell.add(instanced);
          }
          this.darkMaterials.push(darkMaterial);
        } else {
          this.decorMaterials.push(null);
          this.darkMaterials.push(null);
        }

        this.letters.push(cell);
        this.group.add(cell);

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
        const cell = this.letters[i];
        if (cell) cell.position.set(x, y, 0);
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

    for (let i = 0; i < this.letters.length; i++) {
      const cell = this.letters[i];
      if (!cell) continue;

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
      cell.position.x = (this.baseX[i] as number) + pose.position[0];
      cell.position.y = (this.baseY[i] as number) + pose.position[1];
      cell.position.z = pose.position[2];
      cell.rotation.set(...pose.rotation);
      cell.scale.setScalar(pose.scale);
      const material = this.bodyMaterials[i];
      if (material) material.opacity = pose.opacity * this.bodyOpacity;
      const decor = this.decorMaterials[i];
      if (decor) decor.opacity = pose.opacity * this.decorOpacity;
      const dark = this.darkMaterials[i];
      if (dark) dark.opacity = pose.opacity * this.darkOpacity;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cache.dispose();
    for (const material of this.bodyMaterials) material?.dispose();
    this.bodyMaterials.length = 0;
    for (const material of this.decorMaterials) material?.dispose();
    this.decorMaterials.length = 0;
    for (const material of this.darkMaterials) material?.dispose();
    this.darkMaterials.length = 0;
    this.decorCache?.dispose();
    this.chunkGeo?.dispose();
    // An InstancedMesh owns an instanceMatrix buffer that clearing the group does not free.
    for (const cell of this.letters) {
      for (const child of cell?.children ?? []) {
        if (child instanceof THREE.InstancedMesh) child.dispose();
      }
    }
    this.group.clear();
  }
}
