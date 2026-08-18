import type { Font, PathCommand } from 'opentype.js';
import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Timeline } from '../../src/motion/compositor.js';
import type { LetterInfo, MotionPiece } from '../../src/motion/types.js';
import { NONE } from '../../src/motion/types.js';
import type { PoseOffset } from '../../src/pose.js';
import { Word } from '../../src/render/word.js';
import type { LoadedFont } from '../../src/text/font.js';
import type { Budget } from '../../src/text/layout.js';

const UPEM = 1000;
const ADVANCE = 600;
/** One advance in em units — the layout gap between two adjacent letters. */
const STEP = ADVANCE / UPEM;
const NBSP = '\u00a0';
const ZWJ = '\u200d';
const BLANK = new Set([' ', NBSP, ZWJ]);
const DESCENDS = new Set(['g']);

/** Box spanning `bottom`..`top` in three's y-up space; opentype paths are y-down. */
function boxPath(w: number, top: number, bottom: number): PathCommand[] {
  return [
    { type: 'M', x: 0, y: -bottom },
    { type: 'L', x: w, y: -bottom },
    { type: 'L', x: w, y: -top },
    { type: 'L', x: 0, y: -top },
    { type: 'Z' },
  ];
}

/** Chars are 0.5 em wide boxes rising 0.7 em; 'g' also drops 0.2 em, and blanks draw nothing. */
function stubFont(): LoadedFont {
  const font = {
    charToGlyph: (char: string) => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({
        commands: BLANK.has(char)
          ? []
          : boxPath(0.5 * size, 0.7 * size, DESCENDS.has(char) ? -0.2 * size : 0),
      }),
    }),
  } as unknown as Font;

  return {
    font,
    unitsPerEm: UPEM,
    metrics: { advanceOf: () => ADVANCE, kernOf: () => 0 },
  };
}

const ROOMY: Budget = { width: 100, height: 100 };

function timelineOf(offset: MotionPiece['offset']): Timeline {
  return new Timeline({
    enter: { duration: 100, offset },
    active: NONE,
    exit: NONE,
    hold: 0,
    blendMs: 0,
  });
}

function meshes(word: Word): THREE.Mesh[] {
  return word.group.children as THREE.Mesh[];
}

function materialOf(word: Word): THREE.MeshPhysicalMaterial {
  return (meshes(word)[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
}

/** World-space midpoint of the advance span the drawn glyphs occupy. */
function inkCenter(word: Word): number {
  const drawn = meshes(word);
  const first = drawn[0] as THREE.Mesh;
  const last = drawn[drawn.length - 1] as THREE.Mesh;
  const span = (first.position.x + last.position.x + STEP) / 2;
  return word.group.position.x + word.group.scale.x * span;
}

/** Vertical extent the drawn glyphs cover, in group-local units. */
function inkSpanY(word: Word): { min: number; max: number } {
  const boxes = meshes(word).map((m) => m.geometry.boundingBox as THREE.Box3);
  return {
    min: Math.min(...boxes.map((b) => b.min.y)),
    max: Math.max(...boxes.map((b) => b.max.y)),
  };
}

/** World-space vertical midpoint of that ink, before any pose is applied. */
function inkCenterY(word: Word): number {
  const { min, max } = inkSpanY(word);
  return word.group.position.y + word.group.scale.x * ((min + max) / 2);
}

describe('Word', () => {
  it('gives every code point a slot but only the drawn glyphs a mesh', () => {
    const word = new Word('A B', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(3);
    expect(meshes(word)).toHaveLength(2);
  });

  it('treats any outline-less glyph as blank, not just the space character', () => {
    const word = new Word(`A${NBSP}B${ZWJ}C`, stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(5);
    expect(meshes(word)).toHaveLength(3);
  });

  it('shares one cached geometry across repeated letters', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const [a, b] = meshes(word);

    expect(a?.geometry).toBe(b?.geometry);
  });

  it('lays letters out one advance apart', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const [a, b] = meshes(word);

    expect((b?.position.x ?? 0) - (a?.position.x ?? 0)).toBeCloseTo(STEP, 10);
  });

  it('adds pose x onto the layout x instead of replacing it', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const [restA, restB] = meshes(word).map((m) => m.position.x);
    word.apply(
      timelineOf(() => ({ position: [1, 0, 0] })),
      50,
    );
    const [a, b] = meshes(word);

    expect(a?.position.x).toBeCloseTo((restA as number) + 1, 10);
    expect(b?.position.x).toBeCloseTo((restB as number) + 1, 10);
    expect((restB as number) - (restA as number)).toBeCloseTo(STEP, 10);
  });

  it('adds pose y onto the layout y, and takes z, rotation and scale absolutely', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    const rest = (meshes(word)[0] as THREE.Mesh).position.y;
    word.apply(
      timelineOf(() => ({ position: [0, 2, 3], rotation: [0.1, 0.2, 0.3], scale: 4 })),
      50,
    );
    const [a] = meshes(word);

    expect(a?.position.y).toBeCloseTo(rest + 2, 10);
    expect(a?.position.z).toBeCloseTo(3, 10);
    expect([a?.rotation.x, a?.rotation.y, a?.rotation.z]).toEqual([0.1, 0.2, 0.3]);
    expect(a?.scale.x).toBeCloseTo(4, 10);
  });

  it('hands the timeline each letter index including the blanks it skips', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('A B', stubFont(), 'gold', ROOMY);

    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      50,
    );

    expect(seen.map((l) => [l.index, l.count])).toEqual([
      [0, 3],
      [2, 3],
    ]);
  });

  it('centers the word on both axes', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);

    expect(inkCenter(word)).toBeCloseTo(0, 10);
    expect(inkCenterY(word)).toBeCloseTo(0, 10);
  });

  it('centers on the ink, so a descender is not left hanging below the frame', () => {
    const font = stubFont();
    const plain = new Word('AA', font, 'gold', ROOMY);
    const dropped = new Word('Ag', font, 'gold', ROOMY);

    expect(inkCenterY(dropped)).toBeCloseTo(0, 10);
    // Cap-height centering would put both at the same y; a lower ink center has to raise the group.
    expect(dropped.group.position.y).toBeGreaterThan(plain.group.position.y);
  });

  it('fits the ink height, descender included, rather than the cap height', () => {
    const font = stubFont();
    const loose = new Word('g', font, 'gold', ROOMY);
    const { min, max } = inkSpanY(loose);

    const fitted = new Word('g', font, 'gold', { width: 100, height: (max - min) / 2 });

    expect(fitted.group.scale.x).toBeCloseTo(0.5, 10);
  });

  it('centers on the drawn glyphs, so surrounding whitespace does not shift the word', () => {
    const font = stubFont();
    const plain = new Word('AA', font, 'gold', ROOMY);
    const trailing = new Word('AA  ', font, 'gold', ROOMY);
    const leading = new Word('  AA', font, 'gold', ROOMY);

    expect(inkCenter(trailing)).toBeCloseTo(0, 10);
    expect(inkCenter(leading)).toBeCloseTo(0, 10);
    expect(trailing.group.scale.x).toBeCloseTo(plain.group.scale.x, 10);
    expect(leading.group.scale.x).toBeCloseTo(plain.group.scale.x, 10);
  });

  it('scales the word down to the budget it is given', () => {
    // Two letters span two advances, so a budget of one advance has to halve them.
    const word = new Word('AA', stubFont(), 'gold', { width: STEP, height: 100 });

    expect(word.group.scale.x).toBeCloseTo(0.5, 10);
    expect(inkCenter(word)).toBeCloseTo(0, 10);
  });

  it('falls back to the fit cap for a word with nothing to draw', () => {
    const word = new Word('  ', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(2);
    expect(meshes(word)).toHaveLength(0);
    expect(word.group.scale.x).toBe(2.2);
    expect(word.group.position.x).toBeCloseTo(0, 10);
  });

  it('renders through the transparent path so an exit can fade', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);

    expect(materialOf(word).transparent).toBe(true);
  });

  it('gives each letter its own material', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const [a, b] = meshes(word);

    expect((a as THREE.Mesh).material).not.toBe((b as THREE.Mesh).material);
  });

  it('fades each letter on its own schedule', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const fadeByIndex = (_t: number, letter: LetterInfo): PoseOffset => ({
      opacity: letter.index === 0 ? 1 : 0,
    });

    word.apply(timelineOf(fadeByIndex), 50);

    const [a, b] = meshes(word);
    expect(((a as THREE.Mesh).material as THREE.MeshPhysicalMaterial).opacity).toBe(1);
    expect(((b as THREE.Mesh).material as THREE.MeshPhysicalMaterial).opacity).toBe(0);
  });

  it('applies the look to every letter material', () => {
    const word = new Word('AB', stubFont(), 'chrome', ROOMY);

    for (const mesh of meshes(word)) {
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      expect(mat.metalness).toBe(1);
      expect(mat.roughness).toBeCloseTo(0.05, 10);
    }
  });

  it('disposes the glyph geometry and the material, and empties the group', () => {
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    const [a, b] = meshes(word);
    const geoA = vi.spyOn(a?.geometry as THREE.BufferGeometry, 'dispose');
    const geoB = vi.spyOn(b?.geometry as THREE.BufferGeometry, 'dispose');
    const material = vi.spyOn(materialOf(word), 'dispose');

    word.dispose();

    expect(geoA).toHaveBeenCalled();
    expect(geoB).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
    expect(word.group.children).toHaveLength(0);
  });

  it('goes inert after dispose rather than posing into a disposed material', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    const [a] = meshes(word);
    const material = (a as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    const rest = (a as THREE.Mesh).position.x;

    word.dispose();
    word.apply(
      timelineOf(() => ({ position: [5, 0, 0], opacity: 0.25 })),
      50,
    );

    expect(a?.position.x).toBe(rest);
    expect(material.opacity).toBe(1);
  });
});

describe('Word as a block', () => {
  it('gives every line its own row of letters', () => {
    const word = new Word('AB\nCD', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(4);
    expect(meshes(word)).toHaveLength(4);
    expect(word.lineCount).toBe(2);
  });

  it('drops each line below the one above it', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    const [first, second] = meshes(word);

    expect((second as THREE.Mesh).position.y).toBeLessThan((first as THREE.Mesh).position.y);
  });

  it('centers each line independently', () => {
    const word = new Word('AA\nB', stubFont(), 'gold', ROOMY);
    const [a1, a2, b] = meshes(word);
    const rowCenter = ((a1 as THREE.Mesh).position.x + (a2 as THREE.Mesh).position.x) / 2;

    expect((b as THREE.Mesh).position.x).toBeCloseTo(rowCenter, 5);
  });

  it('adds pose y onto the line baseline instead of replacing it', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    const before = meshes(word).map((m) => m.position.y);

    word.apply(
      timelineOf(() => ({ position: [0, 1, 0] })),
      0,
    );

    const after = meshes(word).map((m) => m.position.y);
    expect(after[0] as number).toBeCloseTo((before[0] as number) + 1, 5);
    expect(after[1] as number).toBeCloseTo((before[1] as number) + 1, 5);
    // The lines must stay apart; a replaced baseline collapses them onto one row.
    expect(after[0] as number).not.toBeCloseTo(after[1] as number, 5);
  });

  it('reports each letter its position in the block', () => {
    const word = new Word('AB\nC', stubFont(), 'gold', ROOMY);
    const seen: LetterInfo[] = [];

    word.apply(
      timelineOf((_t, letter) => {
        seen.push(letter);
        return {};
      }),
      0,
    );

    expect(seen.map((l) => l.line)).toEqual([0, 0, 1]);
    expect(seen.map((l) => l.column)).toEqual([0, 1, 0]);
    expect(seen.map((l) => l.index)).toEqual([0, 1, 2]);
    expect(seen[0]?.lineCount).toBe(2);
    expect(seen[0]?.columnCount).toBe(2);
  });

  it('wraps only when asked', () => {
    const narrow: Budget = { width: 1.2, height: 100 };

    expect(new Word('AA BB', stubFont(), 'gold', narrow, true).lineCount).toBeGreaterThan(1);
    expect(new Word('AA BB', stubFont(), 'gold', narrow, false).lineCount).toBe(1);
  });

  it('centers the block vertically, so a two-line block straddles the origin', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    const ys = meshes(word).map((m) => word.group.position.y + word.group.scale.x * m.position.y);

    expect((ys[0] as number) > 0).toBe(true);
    expect((ys[1] as number) < 0).toBe(true);
  });

  it('a newline never reaches the glyph cache, so it draws no tofu', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(2);
    expect(meshes(word)).toHaveLength(2);
  });
});

describe('flake seeding', () => {
  const seedOf = (mesh: THREE.Mesh) =>
    (mesh.geometry.getAttribute('aSeed').array as Float32Array)[0];

  it('gives each letter its own seed, or repeated letters sparkle in lockstep', () => {
    const word = new Word('AA', stubFont(), 'flake', ROOMY);
    const seeds = meshes(word).map(seedOf);

    expect(seeds).toHaveLength(2);
    expect(seeds[0]).not.toBe(seeds[1]);
  });

  it('carries one seed value across every vertex of a letter', () => {
    const word = new Word('A', stubFont(), 'flake', ROOMY);
    const attribute = (meshes(word)[0] as THREE.Mesh).geometry.getAttribute('aSeed');
    const values = new Set(attribute.array as Float32Array);

    expect(attribute.count).toBe(
      (meshes(word)[0] as THREE.Mesh).geometry.getAttribute('position').count,
    );
    expect(values.size).toBe(1);
  });

  it('leaves the cached geometry untouched, since the cache owns it', () => {
    const word = new Word('AA', stubFont(), 'flake', ROOMY);
    const [first, second] = meshes(word);

    expect((first as THREE.Mesh).geometry).not.toBe((second as THREE.Mesh).geometry);
  });

  it('disposes the per-letter clones it created', () => {
    const word = new Word('AB', stubFont(), 'flake', ROOMY);
    const spies = meshes(word).map((m) => vi.spyOn(m.geometry, 'dispose'));

    word.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
