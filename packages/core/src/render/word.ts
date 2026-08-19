import * as THREE from 'three';
import { blankPose, type Timeline } from '../motion/compositor.js';
import type { LetterInfo } from '../motion/types.js';
import type { LoadedFont } from '../text/font.js';
import {
  buildGlyphGeometry,
  DEFAULT_GLYPH_OPTIONS,
  GlyphCache,
  glyphToShapes,
} from '../text/glyphs.js';
import type { Budget, GlyphMetrics, Line, PlacedGlyph } from '../text/layout.js';
import { layoutBlock, wrapBlock } from '../text/layout.js';
import { type Fit, fitOf, placeBlock } from '../text/placement.js';
import type { Transform } from '../transform.js';
import {
  type Blueprint,
  buildChunkBlueprint,
  buildTubeBlueprint,
  chunkGeometry,
  chunkGeometrySide,
  chunkMatrices,
  type DecorationSpec,
  type TubeBlueprint,
} from './decoration.js';
import type { FlakeUniforms } from './flake.js';
import {
  applyLook,
  createMaterial,
  type Look,
  type LookSpec,
  specOf,
  tintMaterialOf,
} from './looks.js';

const EM = 1; // glyphs are built at 1 em; the group scale does the fitting

/**
 * Lab-only diagnostic hooks (see debug.ts). Word owns per-letter layout and the tube pipeline,
 * so a debug view has to plug in here rather than re-deriving either outside core. `createBlitsklieg`
 * never supplies one, so every real caller is unaffected.
 */
export interface WordDebugHooks {
  /** Overrides a tube decoration's lit or dark run material; undefined keeps the normal one. */
  tubeMaterial?(which: 'lit' | 'dark'): THREE.Material | undefined;
  /** Called once per drawn letter with its own transformed group, outline shapes, and extrude depth. */
  onLetter?(cell: THREE.Group, shapes: THREE.Shape[], depth: number): void;
}

/** One group per letter — per-letter motion (spin, flip, shatter) needs independent transforms. */
export class Word {
  readonly group = new THREE.Group();
  /** Sits between `group` (the viewport fit) and the letters — see the `transform` accessor. */
  private readonly inner = new THREE.Group();
  /** null where the glyph drew no outline (space, U+00A0, ZWJ); the slot still holds its index. */
  private readonly letters: (THREE.Group | null)[] = [];
  /** Layout x per letter. Pose x is an OFFSET onto this — overwriting it collapses the word. */
  private readonly baseX: number[] = [];
  /** Layout y per letter, for the same reason: pose y adds onto it, or the lines stack up. */
  private readonly baseY: number[] = [];
  private readonly lineOf: number[] = [];
  private readonly columnOf: number[] = [];
  /** Every glyph's character, so a regroup can lay the survivors out again. */
  private readonly charOf: string[] = [];
  /** Per-letter vertical bounds in em; null where the glyph drew nothing. */
  private readonly geoMinY: (number | null)[] = [];
  private readonly geoMaxY: (number | null)[] = [];
  private readonly metrics: GlyphMetrics;
  private fit: Fit;
  /** Reading position within the live group; a regroup renumbers it. */
  private readonly idxOf: number[] = [];
  /** Set on a letter a regroup dropped; its info stops tracking the live group. */
  private readonly frozenInfo: (LetterInfo | null)[] = [];
  readonly lineCount: number;
  private readonly columnCount: number;
  /** Indexed by letter slot, null where the glyph drew no outline. */
  private readonly bodyMaterials: (THREE.MeshPhysicalMaterial | null)[] = [];
  /** A debug hook may swap in a non-physical material, so these are typed to the material base. */
  private readonly decorMaterials: (THREE.Material | null)[] = [];
  /** A tube decoration's unlit-run material, one per letter; null for every non-tube letter. */
  private readonly darkMaterials: (THREE.Material | null)[] = [];
  private readonly cache: GlyphCache;
  private readonly decorCache: GlyphCache<Blueprint> | null;
  /** Tube blueprints, one per letter — a per-letter seed can't go through the char-keyed cache. */
  private readonly tubeBlueprints: TubeBlueprint[] = [];
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
    debug?: WordDebugHooks,
  ) {
    this.group.add(this.inner);

    const spec = specOf(look);
    this.bodyOpacity = spec.opacity ?? 1;

    this.cache = new GlyphCache((char, depth) =>
      buildGlyphGeometry(font.font, char, EM, { ...DEFAULT_GLYPH_OPTIONS, depth }),
    );

    const decoration = spec.decoration;
    this.decorOpacity = decoration?.look.opacity ?? 1;
    this.darkOpacity = decoration?.kind === 'tube' ? (decoration.dark.opacity ?? 1) : 1;
    this.chunkGeo = decoration?.kind === 'chunks' ? chunkGeometry(decoration.shape) : null;
    // A tube's runs need a per-letter seed, so two letters of the same char don't repeat the
    // same partial-lit pattern — that can't go through a cache keyed on (char, depth) alone.
    this.decorCache =
      decoration && decoration.kind !== 'tube'
        ? new GlyphCache<Blueprint>((char, depth) =>
            buildChunkBlueprint(this.cache.get(char, depth)),
          )
        : null;

    const scaleToEm = EM / font.unitsPerEm;
    const block = wrap
      ? wrapBlock(text, font.metrics, budget, font.unitsPerEm)
      : layoutBlock(text, font.metrics);

    this.metrics = font.metrics;

    const placed = placeBlock(block, scaleToEm, font.metrics, (char) => this.drawsInk(char));
    this.lineCount = placed.lineCount;
    this.columnCount = placed.columnCount;

    // Bounds first, cells second. The glyph cache memoizes on (char, depth), so measuring every
    // glyph before building anything costs one extra map lookup per letter — and it settles the
    // fit, which a per-letter tint callback needs in order to be handed a meaningful `y`.
    for (let i = 0; i < placed.x.length; i++) {
      const line = block.lines[placed.line[i] as number] as Line;
      const g = line.glyphs[placed.column[i] as number] as PlacedGlyph;
      const geo = this.cache.get(g.char, DEFAULT_GLYPH_OPTIONS.depth);
      const drawn = geo.attributes.position?.count ? geo.boundingBox : null;
      this.charOf.push(g.char);
      this.baseX.push(placed.x[i] as number);
      this.baseY.push(placed.y[i] as number);
      this.lineOf.push(placed.line[i] as number);
      this.columnOf.push(placed.column[i] as number);
      this.idxOf.push(i);
      this.frozenInfo.push(null);
      this.geoMinY.push(drawn ? drawn.min.y : null);
      this.geoMaxY.push(drawn ? drawn.max.y : null);
    }
    this.fit = fitOf(
      placed,
      this.charOf,
      this.geoMinY,
      this.geoMaxY,
      font.metrics,
      scaleToEm,
      budget,
    );
    this.applyFit(this.fit);

    for (let i = 0; i < this.charOf.length; i++) {
      this.buildCell(i, font, look, spec, decoration, tint, debug);
    }
  }

  /** A glyph draws ink when its geometry has vertices — the same test the cell build uses. */
  private drawsInk(char: string): boolean {
    return !!this.cache.get(char, DEFAULT_GLYPH_OPTIONS.depth).attributes.position?.count;
  }

  private applyFit(fit: Fit): void {
    this.group.scale.setScalar(fit.scale);
    this.group.position.set(0, -fit.midY * fit.scale, 0);
  }

  private buildCell(
    i: number,
    font: LoadedFont,
    look: Look,
    spec: LookSpec,
    decoration: DecorationSpec | undefined,
    tint: number | undefined,
    debug: WordDebugHooks | undefined,
  ): void {
    const char = this.charOf[i] as string;
    const geo = this.cache.get(char, DEFAULT_GLYPH_OPTIONS.depth);
    if (!geo.attributes.position?.count) {
      this.letters.push(null);
      this.bodyMaterials.push(null);
      this.decorMaterials.push(null);
      this.darkMaterials.push(null);
      return;
    }

    const material = createMaterial();
    applyLook(material, look, tintMaterialOf(spec) === 'body' ? tint : undefined);
    // Enters and exits animate opacity, and flipping this mid-run would recompile the shader.
    material.transparent = true;
    // A near-transparent backing still writes depth by default, which culls the tube drawn
    // behind it — the sign vanishes as the tube thins rather than being occluded by anything visible.
    material.depthWrite = (spec.opacity ?? 1) >= 1;
    (material.userData.flake as FlakeUniforms).uFlakeSeed.value = i * 17.13;
    this.bodyMaterials.push(material);

    const cell = new THREE.Group();
    cell.add(new THREE.Mesh(geo, material));

    let debugShapes: THREE.Shape[] | undefined;

    if (decoration && decoration.kind === 'tube') {
      const litOverride = debug?.tubeMaterial?.('lit');
      const decorMaterial = litOverride ?? createMaterial();
      if (!litOverride) {
        applyLook(
          decorMaterial as THREE.MeshPhysicalMaterial,
          decoration.look,
          tintMaterialOf(spec) === 'decoration' ? tint : undefined,
        );
      }
      decorMaterial.transparent = true;
      // A yawed or curved tube can turn its inside surface toward the camera; FrontSide
      // would cull that invisible.
      decorMaterial.side = THREE.DoubleSide;
      this.decorMaterials.push(decorMaterial);

      const darkOverride = debug?.tubeMaterial?.('dark');
      const darkMaterial = darkOverride ?? createMaterial();
      if (!darkOverride) applyLook(darkMaterial as THREE.MeshPhysicalMaterial, decoration.dark);
      darkMaterial.transparent = true;
      darkMaterial.side = THREE.DoubleSide;
      this.darkMaterials.push(darkMaterial);

      const shapes = glyphToShapes(font.font, char, EM);
      debugShapes = shapes;
      const blueprint = buildTubeBlueprint(shapes, decoration, DEFAULT_GLYPH_OPTIONS.depth, i);
      this.tubeBlueprints.push(blueprint);
      for (const geo of blueprint.lit) cell.add(new THREE.Mesh(geo, decorMaterial));
      for (const geo of blueprint.dark) cell.add(new THREE.Mesh(geo, darkMaterial));
    } else if (decoration && this.decorCache) {
      const decorMaterial = createMaterial();
      applyLook(
        decorMaterial,
        decoration.look,
        tintMaterialOf(spec) === 'decoration' ? tint : undefined,
      );
      decorMaterial.transparent = true;
      if (decoration.kind === 'chunks') decorMaterial.side = chunkGeometrySide(decoration.shape);
      this.decorMaterials.push(decorMaterial);
      this.darkMaterials.push(null);

      const blueprint = this.decorCache.get(char, DEFAULT_GLYPH_OPTIONS.depth);
      if (decoration.kind === 'chunks' && blueprint.kind === 'chunks' && this.chunkGeo) {
        const matrices = chunkMatrices(blueprint, decoration, i);
        const instanced = new THREE.InstancedMesh(this.chunkGeo, decorMaterial, matrices.length);
        for (let m = 0; m < matrices.length; m++) {
          instanced.setMatrixAt(m, matrices[m] as THREE.Matrix4);
        }
        instanced.instanceMatrix.needsUpdate = true;
        cell.add(instanced);
      }
    } else {
      this.decorMaterials.push(null);
      this.darkMaterials.push(null);
    }

    if (debug?.onLetter) {
      debug.onLetter(
        cell,
        debugShapes ?? glyphToShapes(font.font, char, EM),
        DEFAULT_GLYPH_OPTIONS.depth,
      );
    }

    cell.position.set(this.baseX[i] as number, this.baseY[i] as number, 0);
    this.letters.push(cell);
    this.inner.add(cell);
  }

  get letterCount(): number {
    return this.letters.length;
  }

  /**
   * Turns the whole word as one rigid object — never per letter, and never the camera, so the
   * viewport fit stays put. Applied on a group between the fit and the letters, so it composes
   * with the fit instead of overwriting it.
   */
  get transform(): Transform {
    return new THREE.Matrix4()
      .compose(this.inner.position, this.inner.quaternion, this.inner.scale)
      .toArray();
  }

  set transform(matrix: Transform) {
    new THREE.Matrix4()
      .fromArray(matrix as number[])
      .decompose(this.inner.position, this.inner.quaternion, this.inner.scale);
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
    for (const blueprint of this.tubeBlueprints) blueprint.dispose();
    this.tubeBlueprints.length = 0;
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
