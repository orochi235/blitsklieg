# Decoration Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four looks that add a second geometry and material per letter — `tubing`, `piping`, `sequin`, `pyrite` — on plumbing shared by both generators.

**Architecture:** `Word` stops sharing one material across the word and holds one per letter per layer, which removes the `max()` opacity collapse and lets the flake seed become a uniform instead of a cloned vertex attribute. Each letter becomes a `THREE.Group` so one pose drives body and decoration together. A new `decoration.ts` builds per-char *blueprints* — swept tube geometry, or an area-weighted surface sample pool — cached in a second `GlyphCache`.

**Tech Stack:** TypeScript, three.js (main entry only — never `three/examples/jsm`), Vitest for logic, Playwright for visual baselines.

**Spec:** `docs/superpowers/specs/2026-08-18-decoration-layer-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/render/decoration.ts` | **New.** `DecorationSpec`, blueprint types, both generators, seeded RNG, per-letter chunk matrices. |
| `packages/core/src/render/looks.ts` | `LookSpec` gains `opacity`, `tintTo`, `decoration`; four new `LOOKS` entries; tint routing. |
| `packages/core/src/render/flake.ts` | Seed moves from a vertex attribute to a uniform; `seedGeometry` and `SEED_ATTRIBUTE` are deleted. |
| `packages/core/src/render/word.ts` | Per-letter materials, `Group` per letter, decoration construction and disposal. |
| `packages/core/src/index.ts` | Re-export `DecorationSpec`. |
| `apps/lab/index.html`, `apps/lab/src/main.ts` | Sliders for every decoration parameter. |
| `packages/core/test/render/decoration.test.ts` | **New.** Both generators. |
| `packages/core/test/render/word.test.ts` | Group-per-letter and per-letter material assertions. |
| `packages/core/test/render/flake.test.ts` | Seed-as-uniform assertions. |
| `packages/core/test/render/looks.test.ts` | New presets, `opacity`, `tintTo`. |
| `apps/lab/test/looks.spec.ts` | Visual baseline per new look. |

Tasks 1 and 2 are prerequisite refactors with no new features; the ordering matters because the flake seed cannot become a uniform until materials are per-letter (a shared uniform would put every letter's flakes back in lockstep, which is the bug `seedGeometry` exists to prevent).

---

## Task 1: One material per letter

**Files:**
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the test at `packages/core/test/render/word.test.ts:234` (`'wears the most visible letter opacity, not the last letter to be posed'`) with these three, and update the `'applies the look to the shared material'` test name at line 245 to `'applies the look to every letter material'`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/core/test/render/word.test.ts -t 'own material'`
Expected: FAIL — both letters currently share one material instance.

- [ ] **Step 3: Make materials per-letter**

In `packages/core/src/render/word.ts`, replace the single material field:

```ts
  private readonly material: THREE.MeshPhysicalMaterial;
```

with an array indexed by letter slot (`null` where the glyph drew nothing):

```ts
  /** Indexed by letter slot, null where the glyph drew no outline. */
  private readonly bodyMaterials: (THREE.MeshPhysicalMaterial | null)[] = [];
```

In the constructor, delete these three lines from the top:

```ts
    this.material = createMaterial();
    applyLook(this.material, look, tint);
    const seeds = specOf(look).flake !== undefined;
    // Enters and exits animate opacity, and flipping this mid-run would recompile the shader.
    this.material.transparent = true;
```

and keep only:

```ts
    const seeds = specOf(look).flake !== undefined;
```

In the glyph loop, `this.letters.push(null)` must also push a null material. Change:

```ts
        if (!geo.attributes.position?.count) {
          this.letters.push(null);
          continue;
        }
```

to:

```ts
        if (!geo.attributes.position?.count) {
          this.letters.push(null);
          this.bodyMaterials.push(null);
          continue;
        }
```

and replace the mesh construction:

```ts
        const mesh = new THREE.Mesh(drawn, this.material);
        this.letters.push(mesh);
        this.group.add(mesh);
```

with:

```ts
        const material = createMaterial();
        applyLook(material, look, tint);
        // Enters and exits animate opacity, and flipping this mid-run would recompile the shader.
        material.transparent = true;
        this.bodyMaterials.push(material);

        const mesh = new THREE.Mesh(drawn, material);
        this.letters.push(mesh);
        this.group.add(mesh);
```

- [ ] **Step 4: Drive opacity per letter**

In `apply()`, delete `let opacity = 0;` and the trailing block:

```ts
      opacity = Math.max(opacity, pose.opacity);
    }
    // One shared material. A staggered enter (spin, flip, rise) fades letters in at different
    // times, so taking the last letter's opacity would hide the word until it caught up.
    this.material.opacity = opacity;
```

replacing it with a per-letter write inside the loop, immediately after `mesh.scale.setScalar(pose.scale);`:

```ts
      const material = this.bodyMaterials[i];
      if (material) material.opacity = pose.opacity;
    }
```

- [ ] **Step 5: Dispose every material**

In `dispose()`, replace `this.material.dispose();` with:

```ts
    for (const material of this.bodyMaterials) material?.dispose();
    this.bodyMaterials.length = 0;
```

- [ ] **Step 6: Fix the dispose test**

The test at `packages/core/test/render/word.test.ts:280` reads `material.opacity` off a captured shared material. Change its capture line from `materialOf(word)` usage to read the first mesh's material before disposal, and keep asserting it stays at 1 after a post-dispose `apply()`. The `materialOf` helper at line 67 still works unchanged — it reads the material off the first mesh.

- [ ] **Step 7: Run the full suite**

Run: `npm run check`
Expected: lint clean, typecheck clean, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "give every letter its own material"
```

---

## Task 2: The flake seed becomes a uniform

**Files:**
- Modify: `packages/core/src/render/flake.ts`
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/flake.test.ts`, `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/render/flake.test.ts`, delete the whole `describe('seedGeometry', ...)` block starting at line 35, drop `seedGeometry` from the import at line 7, and replace the three shader assertions at lines 143-145 with:

```ts
    expect(shader.vertexShader).not.toContain('attribute float aSeed');
    expect(shader.fragmentShader).toContain('uniform float uFlakeSeed');
    expect(shader.uniforms.uFlakeSeed).toBeDefined();
```

Add a uniform-presence test to the `createFlakeUniforms` describe block:

```ts
  it('starts every seed at zero', () => {
    expect(createFlakeUniforms().uFlakeSeed.value).toBe(0);
  });
```

In `packages/core/test/render/word.test.ts`, replace the two `aSeed` tests (the helper at line 368 and the assertion at line 380) with:

```ts
  it('gives each letter a distinct flake seed', () => {
    const word = new Word('AA', stubFont(), 'glitter', ROOMY);
    const [a, b] = meshes(word);
    const seedOf = (mesh: THREE.Mesh) =>
      ((mesh.material as THREE.MeshPhysicalMaterial).userData.flake as FlakeUniforms).uFlakeSeed
        .value;

    expect(seedOf(a as THREE.Mesh)).not.toBe(seedOf(b as THREE.Mesh));
  });

  it('shares one geometry across repeated letters even for a flake look', () => {
    const word = new Word('AA', stubFont(), 'glitter', ROOMY);
    const [a, b] = meshes(word);

    expect((a as THREE.Mesh).geometry).toBe((b as THREE.Mesh).geometry);
  });
```

Add `import type { FlakeUniforms } from '../../src/render/flake.js';` to that file's imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/core/test/render/word.test.ts -t 'distinct flake seed'`
Expected: FAIL — `uFlakeSeed` does not exist.

- [ ] **Step 3: Add the uniform and delete the attribute**

In `packages/core/src/render/flake.ts`, add to the `FlakeUniforms` interface:

```ts
  uFlakeSeed: THREE.IUniform<number>;
```

and to `createFlakeUniforms()`:

```ts
    uFlakeSeed: { value: 0 },
```

Delete `SEED_ATTRIBUTE`, `seedGeometry`, and the docstring above them (lines 46-62).

In `COMMON`, replace `varying float vSeed;` with `uniform float uFlakeSeed;` and change:

```glsl
vec3 bkCellCoord() { return vFlakePos / uFlakeSize + vSeed; }
```

to:

```glsl
vec3 bkCellCoord() { return vFlakePos / uFlakeSize + uFlakeSeed; }
```

Replace the vertex patch in `patchForFlakes` with one that no longer declares an attribute or a seed varying:

```ts
  shader.vertexShader = `varying vec3 vFlakePos;\n${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\nvFlakePos = transformed;',
  );
```

`writeFlakeUniforms` is unchanged — the seed is per letter, not per look, so `Word` writes it.

- [ ] **Step 4: Write the seed from Word**

In `packages/core/src/render/word.ts`, change the import at line 7 from `import { seedGeometry } from './flake.js';` to:

```ts
import type { FlakeUniforms } from './flake.js';
```

Delete the `seeded` field and its docstring:

```ts
  /** Per-letter clones carrying the flake seed. The cache owns the originals, not these. */
  private readonly seeded: THREE.BufferGeometry[] = [];
```

Delete the clone block and its comment from the glyph loop:

```ts
        // The cache shares one geometry per (char, depth), which would give every letter an
        // identical flake field — the two Ls in HELLO sparkling in lockstep. Only a flake look
        // pays for the clone that carries a per-letter seed, and the extrusion behind it still
        // happens only once either way.
        let drawn: THREE.BufferGeometry = geo;
        if (seeds) {
          drawn = seedGeometry(geo, this.letters.length * 17.13);
          this.seeded.push(drawn);
        }
```

and use the cached geometry directly, seeding the material instead. Replace the mesh construction added in Task 1 with:

```ts
        const material = createMaterial();
        applyLook(material, look, tint);
        // Enters and exits animate opacity, and flipping this mid-run would recompile the shader.
        material.transparent = true;
        if (seeds) {
          (material.userData.flake as FlakeUniforms).uFlakeSeed.value = this.letters.length * 17.13;
        }
        this.bodyMaterials.push(material);

        const mesh = new THREE.Mesh(geo, material);
        this.letters.push(mesh);
        this.group.add(mesh);
```

In `dispose()`, delete:

```ts
    for (const geo of this.seeded) geo.dispose();
    this.seeded.length = 0;
```

- [ ] **Step 5: Run the full suite**

Run: `npm run check`
Expected: all pass. If `tsc` complains about an unused `THREE` import in `word.ts`, leave it — `THREE.Mesh` is still used.

- [ ] **Step 6: Verify the flake looks still render**

Run: `npm run test:visual -- -g 'flake|glitter|leather'`
Expected: PASS against existing baselines. The seed values are identical to before (`index * 17.13`), so the rendered field must not move. **If these fail, stop** — the seed is reaching the shader differently, not merely differently plumbed.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/render/flake.ts packages/core/src/render/word.ts packages/core/test/render/flake.test.ts packages/core/test/render/word.test.ts
git commit -m "carry the flake seed on a uniform instead of a cloned attribute"
```

---

## Task 3: Body opacity as a pose multiplier

**Files:**
- Modify: `packages/core/src/render/looks.ts`
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/looks.test.ts`, `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/render/looks.test.ts`:

```ts
  it('leaves opacity off the material, because Word owns it per frame', () => {
    const material = createMaterial();

    applyLook(material, { opacity: 0.2 });

    expect(material.opacity).toBe(1);
  });
```

Add to `packages/core/test/render/word.test.ts`:

```ts
  it('multiplies pose opacity by the look base opacity', () => {
    const word = new Word('A', stubFont(), { opacity: 0.5 }, ROOMY);

    word.apply(timelineOf(() => ({ opacity: 0.4 })), 50);

    expect(materialOf(word).opacity).toBeCloseTo(0.2, 10);
  });

  it('treats a look with no declared opacity as fully opaque', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);

    word.apply(timelineOf(() => ({ opacity: 0.4 })), 50);

    expect(materialOf(word).opacity).toBeCloseTo(0.4, 10);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/core/test/render/word.test.ts -t 'base opacity'`
Expected: FAIL — `opacity` is not a recognised `LookSpec` field.

- [ ] **Step 3: Add the field**

In `packages/core/src/render/looks.ts`, add to the `LookSpec` interface:

```ts
  /** Base opacity of the body, 0..1. Pose opacity multiplies it. */
  opacity?: number;
```

Do **not** add `opacity` to `LookKey`. Every key in `PARAM_KEYS` is written straight onto the material by `applyLook`, and `Word.apply()` overwrites `material.opacity` every frame — a look-declared opacity routed that way would survive until the first tick and no longer. That is the trap this field is shaped to avoid.

- [ ] **Step 4: Read it in Word**

In `packages/core/src/render/word.ts`, add a field:

```ts
  private readonly bodyOpacity: number;
```

Set it in the constructor, next to the existing `const seeds = ...` line:

```ts
    const spec = specOf(look);
    const seeds = spec.flake !== undefined;
    this.bodyOpacity = spec.opacity ?? 1;
```

and in `apply()`, change the per-letter opacity write to:

```ts
      const material = this.bodyMaterials[i];
      if (material) material.opacity = pose.opacity * this.bodyOpacity;
```

- [ ] **Step 5: Run and commit**

Run: `npm run check`
Expected: all pass.

```bash
git add packages/core/src/render/looks.ts packages/core/src/render/word.ts packages/core/test/render/looks.test.ts packages/core/test/render/word.test.ts
git commit -m "let a look declare a base opacity the pose multiplies"
```

---

## Task 4: The tube generator

**Files:**
- Create: `packages/core/src/render/decoration.ts`
- Test: `packages/core/test/render/decoration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/render/decoration.test.ts`:

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTubeBlueprint, type TubeSpec } from '../../src/render/decoration.js';

const SPEC: TubeSpec = {
  kind: 'tube',
  radius: 0.04,
  at: [1],
  segments: 6,
  look: {},
};

/** A square with a square counter — the topology of an `O`. */
function ring(): THREE.Shape {
  const outer = new THREE.Shape();
  outer.moveTo(-0.5, -0.5);
  outer.lineTo(0.5, -0.5);
  outer.lineTo(0.5, 0.5);
  outer.lineTo(-0.5, 0.5);
  outer.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-0.2, -0.2);
  hole.lineTo(-0.2, 0.2);
  hole.lineTo(0.2, 0.2);
  hole.lineTo(0.2, -0.2);
  hole.closePath();
  outer.holes.push(hole);

  return outer;
}

/** A plain square — the topology of an `E`, one contour and no counter. */
function slab(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(-0.5, 0.5);
  s.closePath();
  return s;
}

describe('buildTubeBlueprint', () => {
  it('pipes the counter as well as the outline', () => {
    const blueprint = buildTubeBlueprint([ring()], SPEC, 0.3);

    expect(blueprint.loops).toHaveLength(2);
  });

  it('gives a contour-free shape one loop', () => {
    const blueprint = buildTubeBlueprint([slab()], SPEC, 0.3);

    expect(blueprint.loops).toHaveLength(1);
  });

  it('sweeps one loop per contour per depth fraction', () => {
    const blueprint = buildTubeBlueprint([ring()], { ...SPEC, at: [0, 1] }, 0.3);

    expect(blueprint.loops).toHaveLength(4);
  });

  it('places a loop at the depth fraction it was given', () => {
    const front = buildTubeBlueprint([slab()], { ...SPEC, at: [1] }, 0.3);
    front.loops[0]?.computeBoundingBox();

    expect(front.loops[0]?.boundingBox?.max.z).toBeCloseTo(0.3 + SPEC.radius, 2);
  });

  it('closes the loop without a lopsided seam', () => {
    const blueprint = buildTubeBlueprint([slab()], SPEC, 0.3);
    const loop = blueprint.loops[0] as THREE.BufferGeometry;
    loop.computeBoundingBox();
    const box = loop.boundingBox as THREE.Box3;

    // A square pipes to a loop symmetric about both axes. Leaving the repeated closing point in
    // bulges the spline at the seam, which shows up here and nowhere else.
    expect(box.max.x).toBeCloseTo(-box.min.x, 6);
    expect(box.max.y).toBeCloseTo(-box.min.y, 6);
    expect(box.max.x).toBeCloseTo(box.max.y, 6);
  });

  it('releases every loop on dispose', () => {
    const blueprint = buildTubeBlueprint([ring()], SPEC, 0.3);
    const disposed: THREE.BufferGeometry[] = [];
    for (const loop of blueprint.loops) {
      loop.addEventListener('dispose', () => disposed.push(loop));
    }

    blueprint.dispose();

    expect(disposed).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/test/render/decoration.test.ts`
Expected: FAIL — cannot resolve `../../src/render/decoration.js`.

- [ ] **Step 3: Write the generator**

Create `packages/core/src/render/decoration.ts`:

```ts
import * as THREE from 'three';
import type { LookSpec } from './looks.js';

/** A decoration's own material, in the same plain numbers a look takes. */
export type MaterialSpec = Omit<LookSpec, 'decoration' | 'bloom'>;

export interface TubeSpec {
  kind: 'tube';
  /** Tube radius, in em. */
  radius: number;
  /** Depth fractions to sweep a loop at. `[1]` is the front face. */
  at: number[];
  /** Ring segments around the tube. */
  segments: number;
  look: MaterialSpec;
}

export interface TubeBlueprint {
  kind: 'tube';
  loops: THREE.BufferGeometry[];
  dispose(): void;
}

const CONTOUR_SEGMENTS = 48;

// `getPoints` repeats the opening point on a closed contour. Left in, that coincident knot is a
// degenerate segment the closed spline bulges around, and the loop comes out visibly lopsided.
function contourPoints(contour: THREE.Shape | THREE.Path): THREE.Vector2[] {
  const points = contour.getPoints(CONTOUR_SEGMENTS);
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first && last && first.distanceTo(last) < 1e-6) points.pop();
  return points;
}

export function buildTubeBlueprint(
  shapes: THREE.Shape[],
  spec: TubeSpec,
  depth: number,
): TubeBlueprint {
  const loops: THREE.BufferGeometry[] = [];

  for (const shape of shapes) {
    for (const contour of [shape, ...shape.holes]) {
      const points = contourPoints(contour);
      if (points.length < 3) continue;

      for (const at of spec.at) {
        const z = at * depth;
        // Catmull-Rom rounds the corners of an `E`. That is correct here: neon tube cannot bend
        // square, and cord piping does not either.
        const curve = new THREE.CatmullRomCurve3(
          points.map((p) => new THREE.Vector3(p.x, p.y, z)),
          true,
          'centripetal',
        );
        loops.push(
          new THREE.TubeGeometry(curve, points.length * 2, spec.radius, spec.segments, true),
        );
      }
    }
  }

  return {
    kind: 'tube',
    loops,
    dispose() {
      for (const loop of loops) loop.dispose();
      loops.length = 0;
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/test/render/decoration.test.ts`
Expected: PASS, 6 tests.

Note: `CatmullRomCurve3` guards its centripetal division at `dt < 1e-4`, so the repeated closing
knot never yields NaN — it yields a lopsided loop instead (arc length 4.20361 -> 4.38253 on a unit
square). Pin it by symmetry, which fails when the dedupe is removed; a finiteness assertion cannot.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/decoration.ts packages/core/test/render/decoration.test.ts
git commit -m "sweep a tube along every glyph contour"
```

---

## Task 5: The chunks generator

**Files:**
- Modify: `packages/core/src/render/decoration.ts`
- Test: `packages/core/test/render/decoration.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/render/decoration.test.ts`:

```ts
import {
  buildChunkBlueprint,
  chunkMatrices,
  type ChunkSpec,
} from '../../src/render/decoration.js';

const CHUNKS: ChunkSpec = {
  kind: 'chunks',
  count: 12,
  size: 0.05,
  shape: 'cube',
  align: 0,
  cluster: 0,
  proud: 0.5,
  look: {},
};

function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 0.3);
}

/** Rotation only, so two matrices can be compared for shared orientation. */
function quaternionOf(m: THREE.Matrix4): THREE.Quaternion {
  const q = new THREE.Quaternion();
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return q;
}

describe('buildChunkBlueprint', () => {
  it('samples positions and normals in step', () => {
    const blueprint = buildChunkBlueprint(box());

    expect(blueprint.position.length).toBe(blueprint.normal.length);
    expect(blueprint.position.length % 3).toBe(0);
  });

  it('samples the same pool for the same geometry every time', () => {
    const a = buildChunkBlueprint(box());
    const b = buildChunkBlueprint(box());

    expect(Array.from(a.position)).toEqual(Array.from(b.position));
  });

  it('places every sample on the surface', () => {
    const blueprint = buildChunkBlueprint(box());

    for (let i = 0; i < blueprint.position.length; i += 3) {
      const x = Math.abs(blueprint.position[i] as number);
      const y = Math.abs(blueprint.position[i + 1] as number);
      const z = Math.abs(blueprint.position[i + 2] as number);
      const onFace = x > 0.5 - 1e-6 || y > 0.5 - 1e-6 || z > 0.15 - 1e-6;
      expect(onFace).toBe(true);
    }
  });
});

describe('chunkMatrices', () => {
  it('produces one matrix per requested chunk', () => {
    const matrices = chunkMatrices(buildChunkBlueprint(box()), CHUNKS, 3);

    expect(matrices).toHaveLength(CHUNKS.count);
  });

  it('is deterministic for a given seed', () => {
    const blueprint = buildChunkBlueprint(box());
    const a = chunkMatrices(blueprint, CHUNKS, 3);
    const b = chunkMatrices(blueprint, CHUNKS, 3);

    expect(a[0]?.elements).toEqual(b[0]?.elements);
  });

  it('gives different letters different scatter', () => {
    const blueprint = buildChunkBlueprint(box());
    const a = chunkMatrices(blueprint, CHUNKS, 3);
    const b = chunkMatrices(blueprint, CHUNKS, 4);

    expect(a[0]?.elements).not.toEqual(b[0]?.elements);
  });

  it('shares one orientation across a letter at align 1', () => {
    const blueprint = buildChunkBlueprint(box());
    const matrices = chunkMatrices(blueprint, { ...CHUNKS, align: 1 }, 3);
    const first = quaternionOf(matrices[0] as THREE.Matrix4);

    for (const m of matrices) {
      expect(quaternionOf(m).angleTo(first)).toBeCloseTo(0, 5);
    }
  });

  it('tumbles freely at align 0', () => {
    const blueprint = buildChunkBlueprint(box());
    const matrices = chunkMatrices(blueprint, { ...CHUNKS, align: 0 }, 3);
    const first = quaternionOf(matrices[0] as THREE.Matrix4);
    const spread = matrices.map((m) => quaternionOf(m).angleTo(first));

    expect(Math.max(...spread)).toBeGreaterThan(0.1);
  });

  it('sits chunks proud of the surface', () => {
    const blueprint = buildChunkBlueprint(box());
    const flush = chunkMatrices(blueprint, { ...CHUNKS, proud: 0 }, 3);
    const raised = chunkMatrices(blueprint, { ...CHUNKS, proud: 1 }, 3);

    const at = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m).length();
    expect(at(raised[0] as THREE.Matrix4)).toBeGreaterThan(at(flush[0] as THREE.Matrix4));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/core/test/render/decoration.test.ts -t chunk`
Expected: FAIL — `buildChunkBlueprint` is not exported.

- [ ] **Step 3: Write the generator**

Append to `packages/core/src/render/decoration.ts`:

```ts
export interface ChunkSpec {
  kind: 'chunks';
  /** Chunks per letter. */
  count: number;
  /** Chunk edge, in em. */
  size: number;
  shape: 'flake' | 'cube';
  /** 0 free tumble, 1 one shared lattice per letter. */
  align: number;
  /** 0 even scatter, 1 tight intergrown clumps. */
  cluster: number;
  /** How far a chunk sits proud of the surface, 0..1. */
  proud: number;
  look: MaterialSpec;
}

export interface ChunkBlueprint {
  kind: 'chunks';
  position: Float32Array;
  normal: Float32Array;
  dispose(): void;
}

export type DecorationSpec = TubeSpec | ChunkSpec;
export type Blueprint = TubeBlueprint | ChunkBlueprint;

/** How many surface samples a char shares. Letters draw their own chunks from this pool. */
const POOL = 512;
/** Fixed, so a char's pool is identical across words and across runs. */
const POOL_SEED = 0x5eed;
/** How wide a clustered draw reaches around its anchor, in pool samples. */
const CLUSTER_NEIGHBOURS = 12;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildChunkBlueprint(geometry: THREE.BufferGeometry, pool = POOL): ChunkBlueprint {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  const vertexAt = (i: number) => (index ? index.getX(i) : i);
  const triangles = (index ? index.count : positions.count) / 3;

  // Area-weighted, so the bevel band's many small triangles do not out-vote the large faces.
  const cumulative = new Float32Array(triangles);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let total = 0;
  for (let t = 0; t < triangles; t++) {
    a.fromBufferAttribute(positions, vertexAt(t * 3));
    b.fromBufferAttribute(positions, vertexAt(t * 3 + 1));
    c.fromBufferAttribute(positions, vertexAt(t * 3 + 2));
    total += b.sub(a).cross(c.sub(a)).length() / 2;
    cumulative[t] = total;
  }

  const pick = (target: number) => {
    let lo = 0;
    let hi = triangles - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cumulative[mid] as number) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const random = rng(POOL_SEED);
  const position = new Float32Array(pool * 3);
  const normal = new Float32Array(pool * 3);
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nc = new THREE.Vector3();

  for (let s = 0; s < pool; s++) {
    const t = pick(random() * total);
    let u = random();
    let v = random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;

    a.fromBufferAttribute(positions, vertexAt(t * 3));
    b.fromBufferAttribute(positions, vertexAt(t * 3 + 1));
    c.fromBufferAttribute(positions, vertexAt(t * 3 + 2));
    na.fromBufferAttribute(normals, vertexAt(t * 3));
    nb.fromBufferAttribute(normals, vertexAt(t * 3 + 1));
    nc.fromBufferAttribute(normals, vertexAt(t * 3 + 2));

    position[s * 3] = a.x * w + b.x * u + c.x * v;
    position[s * 3 + 1] = a.y * w + b.y * u + c.y * v;
    position[s * 3 + 2] = a.z * w + b.z * u + c.z * v;
    na.multiplyScalar(w).addScaledVector(nb, u).addScaledVector(nc, v).normalize();
    normal[s * 3] = na.x;
    normal[s * 3 + 1] = na.y;
    normal[s * 3 + 2] = na.z;
  }

  return { kind: 'chunks', position, normal, dispose() {} };
}

function randomQuaternion(random: () => number): THREE.Quaternion {
  // Shoemake's uniform quaternion sampling; Euler angles from three uniform numbers cluster.
  const u1 = random();
  const u2 = random() * Math.PI * 2;
  const u3 = random() * Math.PI * 2;
  const r1 = Math.sqrt(1 - u1);
  const r2 = Math.sqrt(u1);
  return new THREE.Quaternion(
    r1 * Math.sin(u2),
    r1 * Math.cos(u2),
    r2 * Math.sin(u3),
    r2 * Math.cos(u3),
  );
}

export function chunkMatrices(
  blueprint: ChunkBlueprint,
  spec: ChunkSpec,
  seed: number,
): THREE.Matrix4[] {
  const random = rng(Math.round(seed * 2654435761) ^ POOL_SEED);
  const pool = blueprint.position.length / 3;
  const lattice = randomQuaternion(random);

  const chosen: number[] = [];
  const taken = new Set<number>();
  const sample = new THREE.Vector3();
  const other = new THREE.Vector3();

  for (let n = 0; n < spec.count; n++) {
    let index = Math.min(pool - 1, Math.floor(random() * pool));
    // Clustering draws near an already-placed chunk instead of anywhere, which is what leaves
    // bare matrix between clumps rather than an even sprinkle. Taking the single nearest sample
    // instead of one of the k nearest collapses the clump: that map is symmetric, so the draw
    // ping-pongs between one pair of samples forever.
    if (chosen.length > 0 && random() < spec.cluster) {
      const anchor = chosen[Math.floor(random() * chosen.length)] as number;
      sample.set(
        blueprint.position[anchor * 3] as number,
        blueprint.position[anchor * 3 + 1] as number,
        blueprint.position[anchor * 3 + 2] as number,
      );
      const near: number[] = [];
      const far: number[] = [];
      for (let p = 0; p < pool; p++) {
        if (taken.has(p)) continue;
        other.set(
          blueprint.position[p * 3] as number,
          blueprint.position[p * 3 + 1] as number,
          blueprint.position[p * 3 + 2] as number,
        );
        const d = other.distanceToSquared(sample);
        let slot = near.length;
        while (slot > 0 && (far[slot - 1] as number) > d) slot--;
        if (slot < CLUSTER_NEIGHBOURS) {
          near.splice(slot, 0, p);
          far.splice(slot, 0, d);
          if (near.length > CLUSTER_NEIGHBOURS) {
            near.pop();
            far.pop();
          }
        }
      }
      index = near[Math.floor(random() * near.length)] ?? index;
    }
    chosen.push(index);
    taken.add(index);
  }

  const matrices: THREE.Matrix4[] = [];
  const scale = new THREE.Vector3(spec.size, spec.size, spec.size);

  for (const index of chosen) {
    const position = new THREE.Vector3(
      blueprint.position[index * 3] as number,
      blueprint.position[index * 3 + 1] as number,
      blueprint.position[index * 3 + 2] as number,
    );
    const normal = new THREE.Vector3(
      blueprint.normal[index * 3] as number,
      blueprint.normal[index * 3 + 1] as number,
      blueprint.normal[index * 3 + 2] as number,
    );
    position.addScaledVector(normal, spec.size * spec.proud);

    const rotation = randomQuaternion(random).slerp(lattice, spec.align);
    matrices.push(new THREE.Matrix4().compose(position, rotation, scale));
  }

  return matrices;
}

export function chunkGeometry(shape: ChunkSpec['shape']): THREE.BufferGeometry {
  return shape === 'cube' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.PlaneGeometry(1, 1);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/test/render/decoration.test.ts`
Expected: PASS. Also add two tests covering `cluster`, which the assertions above miss entirely — that a `cluster: 1` clump keeps its chunks distinct (the single-nearest algorithm collapses 40 chunks onto 2 points), and that it draws tighter than an even scatter.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/decoration.ts packages/core/test/render/decoration.test.ts
git commit -m "scatter oriented chunks over an area-weighted surface sample pool"
```

---

## Task 6: LookSpec carries a decoration

**Files:**
- Modify: `packages/core/src/render/looks.ts`
- Test: `packages/core/test/render/looks.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/render/looks.test.ts`:

```ts
  it('routes a tint to the body by default', () => {
    expect(tintRouteOf({ color: 0x112233 })).toBe('body');
  });

  it('routes a tint to the decoration when the look says so', () => {
    const spec: LookSpec = {
      tintTo: 'decoration',
      decoration: { kind: 'tube', radius: 0.04, at: [1], segments: 8, look: {} },
    };

    expect(tintRouteOf(spec)).toBe('decoration');
  });

  it('ignores tintTo on a look with no decoration', () => {
    expect(tintRouteOf({ tintTo: 'decoration' })).toBe('body');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/core/test/render/looks.test.ts -t 'routes a tint'`
Expected: FAIL — `tintRouteOf` is not exported.

- [ ] **Step 3: Add the fields and the routing helper**

In `packages/core/src/render/looks.ts`, import the decoration types:

```ts
import type { DecorationSpec } from './decoration.js';
```

Add to the `LookSpec` interface, below the `opacity` field added in Task 3:

```ts
  /** Which material `tint` recolors. Default 'body'. */
  tintTo?: 'body' | 'decoration';
  decoration?: DecorationSpec;
```

and add the helper next to `tintTargetOf`:

```ts
/**
 * `tintTo` only means anything when there is a second material to route to; a look without
 * decoration silently keeps its tint on the body rather than dropping it.
 */
export function tintRouteOf(spec: LookSpec): 'body' | 'decoration' {
  return spec.decoration && spec.tintTo === 'decoration' ? 'decoration' : 'body';
}
```

`decoration.ts` already imports `LookSpec` from `looks.ts` for `MaterialSpec`. That is a type-only cycle, which `import type` resolves at compile time and erases from the emitted JavaScript — verify with `npm run typecheck` in the next step rather than assuming.

- [ ] **Step 4: Run and commit**

Run: `npm run check`
Expected: all pass, no circular-import error.

```bash
git add packages/core/src/render/looks.ts packages/core/test/render/looks.test.ts
git commit -m "let a look declare a decoration and where its tint lands"
```

---

## Task 7: Word builds and drives the decoration

**Files:**
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing tests**

The helpers in `packages/core/test/render/word.test.ts` must move from meshes to groups. Replace `meshes` (line 63) and `materialOf` (line 67) with:

```ts
function groups(word: Word): THREE.Group[] {
  return word.group.children as THREE.Group[];
}

function meshes(word: Word): THREE.Mesh[] {
  return groups(word).map((g) => g.children[0] as THREE.Mesh);
}

function materialOf(word: Word): THREE.MeshPhysicalMaterial {
  return (meshes(word)[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
}
```

`inkCenter` and `inkCenterY` read `.position.x` off the drawn objects — those now come from `groups(word)`, so change both to call `groups(word)` where they call `meshes(word)`. `inkSpanY` reads geometry bounding boxes and stays on `meshes(word)`.

Add these tests:

```ts
  const TUBE: LookSpec = {
    opacity: 0.1,
    decoration: {
      kind: 'tube',
      radius: 0.04,
      at: [1],
      segments: 8,
      look: { emissive: 0xff2d95, opacity: 1 },
    },
  };

  it('wraps every letter in a group', () => {
    const word = new Word('AB', stubFont(), 'gold', ROOMY);

    for (const group of groups(word)) {
      expect(group).toBeInstanceOf(THREE.Group);
      expect(group.children).toHaveLength(1);
    }
  });

  it('adds decoration alongside the body in the same group', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);

    expect(groups(word)[0]?.children.length).toBeGreaterThan(1);
  });

  it('drives body and decoration from one pose', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);

    word.apply(timelineOf(() => ({ position: [3, 0, 0] })), 50);

    expect(groups(word)[0]?.position.x).toBeCloseTo(3, 5);
  });

  it('fades body and decoration to their own base opacities', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);

    word.apply(timelineOf(() => ({ opacity: 0.5 })), 50);

    const group = groups(word)[0] as THREE.Group;
    const body = (group.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    const decor = (group.children[1] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    expect(body.opacity).toBeCloseTo(0.05, 10);
    expect(decor.opacity).toBeCloseTo(0.5, 10);
  });

  it('disposes decoration materials and the decoration cache', () => {
    const word = new Word('A', stubFont(), TUBE, ROOMY);
    const group = groups(word)[0] as THREE.Group;
    const decor = (group.children[1] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    const spy = vi.spyOn(decor, 'dispose');

    word.dispose();

    expect(spy).toHaveBeenCalled();
  });
```

Add `import type { LookSpec } from '../../src/render/looks.js';` and `import * as THREE from 'three';` (the file currently imports it as a type only — change `import type * as THREE from 'three';` to a value import).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/core/test/render/word.test.ts -t 'wraps every letter'`
Expected: FAIL — children are meshes, not groups.

- [ ] **Step 3: Restructure Word around groups**

In `packages/core/src/render/word.ts`, add imports:

```ts
import {
  type Blueprint,
  buildChunkBlueprint,
  buildTubeBlueprint,
  chunkGeometry,
  chunkMatrices,
} from './decoration.js';
import { glyphToShapes } from '../text/glyphs.js';
```

Change the letters field to hold groups and add decoration state:

```ts
  /** null where the glyph drew no outline (space, U+00A0, ZWJ); the slot still holds its index. */
  private readonly letters: (THREE.Group | null)[] = [];
  private readonly decorMaterials: (THREE.MeshPhysicalMaterial | null)[] = [];
  private readonly decorCache: GlyphCache<Blueprint> | null;
  private readonly chunkGeo: THREE.BufferGeometry | null;
  private readonly decorOpacity: number;
```

In the constructor, after `this.bodyOpacity = spec.opacity ?? 1;`, add:

```ts
    const decoration = spec.decoration;
    this.decorOpacity = decoration?.look.opacity ?? 1;
    this.chunkGeo = decoration?.kind === 'chunks' ? chunkGeometry(decoration.shape) : null;
    this.decorCache = decoration
      ? new GlyphCache<Blueprint>((char, depth) =>
          decoration.kind === 'tube'
            ? buildTubeBlueprint(glyphToShapes(font.font, char, EM), decoration, depth)
            : buildChunkBlueprint(
                this.cache.get(char, depth) as unknown as THREE.BufferGeometry,
              ),
        )
      : null;
```

In the glyph loop, replace the mesh construction with a group that carries the body and its decoration:

```ts
        const material = createMaterial();
        applyLook(material, look, tintRouteOf(spec) === 'body' ? tint : undefined);
        material.transparent = true;
        if (seeds) {
          (material.userData.flake as FlakeUniforms).uFlakeSeed.value = this.letters.length * 17.13;
        }
        this.bodyMaterials.push(material);

        const cell = new THREE.Group();
        cell.add(new THREE.Mesh(geo, material));

        if (decoration && this.decorCache) {
          const decorMaterial = createMaterial();
          applyLook(
            decorMaterial,
            decoration.look,
            tintRouteOf(spec) === 'decoration' ? tint : undefined,
          );
          decorMaterial.transparent = true;
          this.decorMaterials.push(decorMaterial);

          const blueprint = this.decorCache.get(g.char, DEFAULT_GLYPH_OPTIONS.depth);
          if (blueprint.kind === 'tube') {
            for (const loop of blueprint.loops) cell.add(new THREE.Mesh(loop, decorMaterial));
          } else if (this.chunkGeo) {
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
        } else {
          this.decorMaterials.push(null);
        }

        this.letters.push(cell);
        this.group.add(cell);
```

The `mesh.position.set(x, y, 0)` line in the centering pass now sets the group's position — rename the local from `mesh` to `cell` there; the property write is unchanged.

In `apply()`, rename the per-letter local from `mesh` to `cell` and add the decoration opacity write next to the body one:

```ts
      const material = this.bodyMaterials[i];
      if (material) material.opacity = pose.opacity * this.bodyOpacity;
      const decor = this.decorMaterials[i];
      if (decor) decor.opacity = pose.opacity * this.decorOpacity;
```

In `dispose()`, add:

```ts
    for (const material of this.decorMaterials) material?.dispose();
    this.decorMaterials.length = 0;
    this.decorCache?.dispose();
    this.chunkGeo?.dispose();
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm run check`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "give every letter a group carrying its body and decoration"
```

---

## Task 8: The four presets

**Files:**
- Modify: `packages/core/src/render/looks.ts`
- Test: `packages/core/test/render/looks.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/render/looks.test.ts`:

```ts
  it('orders every look name', () => {
    expect(LOOK_NAMES).toEqual([
      'gold',
      'chrome',
      'oil',
      'gem',
      'velvet',
      'neon',
      'flake',
      'glitter',
      'leather',
      'tubing',
      'piping',
      'sequin',
      'pyrite',
    ]);
  });

  it('builds tubing and piping from the tube generator', () => {
    for (const name of ['tubing', 'piping'] as const) {
      expect(specOf(name).decoration?.kind).toBe('tube');
    }
  });

  it('builds sequin and pyrite from the chunks generator', () => {
    for (const name of ['sequin', 'pyrite'] as const) {
      expect(specOf(name).decoration?.kind).toBe('chunks');
    }
  });

  it('makes tubing a glowing tube over a near-invisible body', () => {
    const spec = specOf('tubing');

    expect(spec.opacity).toBeLessThan(0.2);
    expect(spec.bloom).toBe(true);
    expect(spec.tintTo).toBe('decoration');
  });

  it('keeps piping tinting the hide, not the cord', () => {
    expect(tintRouteOf(specOf('piping'))).toBe('body');
  });

  it('gives pyrite crystal habit and sequin free tumble', () => {
    const pyrite = specOf('pyrite').decoration;
    const sequin = specOf('sequin').decoration;

    expect(pyrite?.kind === 'chunks' && pyrite.shape).toBe('cube');
    expect(sequin?.kind === 'chunks' && sequin.shape).toBe('flake');
    expect(pyrite?.kind === 'chunks' && pyrite.align).toBeGreaterThan(
      (sequin?.kind === 'chunks' && sequin.align) as number,
    );
  });
```

Update the existing `LOOK_NAMES` ordering test if one already asserts the nine-name list — replace it rather than leaving both.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/core/test/render/looks.test.ts -t 'orders every look name'`
Expected: FAIL — four names missing.

- [ ] **Step 3: Add the names and the presets**

In `packages/core/src/render/looks.ts`, extend the `LookName` union with `'tubing' | 'piping' | 'sequin' | 'pyrite'`, then append to `LOOKS`:

```ts
  tubing: {
    // A backing, not a body: what reads as the sign is the tube in front of it.
    color: 0x0a0010,
    metalness: 0,
    roughness: 0.5,
    clearcoat: 0,
    opacity: 0.08,
    bloom: true,
    tintTo: 'decoration',
    decoration: {
      kind: 'tube',
      radius: 0.045,
      at: [1],
      segments: 10,
      look: {
        color: 0x1a0010,
        emissive: 0xff2d95,
        emissiveIntensity: 3.4,
        clearcoat: 0,
        roughness: 0.35,
      },
    },
  },
  piping: {
    color: 0x5a2f1d,
    metalness: 0,
    roughness: 0.72,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
    sheen: 0.35,
    sheenColor: 0xd8a071,
    flake: { density: 1, size: 1 / 7, spread: 0.5, bump: true },
    decoration: {
      kind: 'tube',
      radius: 0.03,
      at: [1],
      segments: 8,
      look: { color: 0xe8c9a0, roughness: 0.55, clearcoat: 0.4, sheen: 0.5 },
    },
  },
  sequin: {
    color: 0x2a0f1c,
    metalness: 0.6,
    roughness: 0.45,
    clearcoat: 0.4,
    decoration: {
      kind: 'chunks',
      count: 90,
      size: 0.055,
      shape: 'flake',
      align: 0.1,
      cluster: 0.2,
      proud: 0.35,
      look: { color: 0xffd9c0, metalness: 1, roughness: 0.08, clearcoat: 1 },
    },
    tintTo: 'decoration',
  },
  pyrite: {
    color: 0x30302c,
    metalness: 0.2,
    roughness: 0.85,
    clearcoat: 0,
    decoration: {
      kind: 'chunks',
      count: 55,
      size: 0.075,
      shape: 'cube',
      align: 0.85,
      cluster: 0.6,
      proud: 0.45,
      // Brassier and greener than gold's 0xffc44d — fool's gold is what this is imitating.
      look: { color: 0xd8b246, metalness: 1, roughness: 0.22, clearcoatRoughness: 0.1 },
    },
    tintTo: 'decoration',
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/test/render/looks.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm run check`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/looks.ts packages/core/test/render/looks.test.ts
git commit -m "add the tubing, piping, sequin and pyrite looks"
```

---

## Task 9: Public exports

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/index.test.ts`:

```ts
  it('names every look', () => {
    expect(LOOK_NAMES).toHaveLength(13);
    expect(LOOK_NAMES).toContain('tubing');
    expect(LOOK_NAMES).toContain('pyrite');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/test/index.test.ts -t 'names every look'`
Expected: FAIL if an existing count assertion says 9; otherwise PASS once Task 8 landed — in that case keep the test as a regression guard and move on.

- [ ] **Step 3: Export the decoration types**

In `packages/core/src/index.ts`, add alongside the existing `FlakeSpec` export:

```ts
export type { DecorationSpec, MaterialSpec } from './render/decoration.js';
```

- [ ] **Step 4: Check the README stays true**

Run: `npx vitest run packages/core/test/readme.test.ts`
Expected: PASS. If it fails, the README enumerates looks — add the four new names there in the same order as `LOOK_NAMES` and re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index.test.ts README.md
git commit -m "export the decoration spec types"
```

---

## Task 10: Lab controls

**Files:**
- Modify: `apps/lab/index.html`
- Modify: `apps/lab/src/main.ts`

The shipped preset numbers come from tuning here, so every decoration parameter needs a slider before any of them are treated as final.

- [ ] **Step 1: Add the inputs**

In `apps/lab/index.html`, after the `density` row (line 49), add:

```html
      <label>tube radius <input id="radius" type="range" min="1" max="120" step="1" value="45" /></label>
      <label>tube depth <input id="tubeAt" type="range" min="0" max="100" step="5" value="100" /></label>
      <label>chunk count <input id="count" type="range" min="1" max="300" step="1" value="90" /></label>
      <label>chunk size <input id="chunkSize" type="range" min="5" max="200" step="1" value="55" /></label>
      <label>align <input id="align" type="range" min="0" max="100" step="1" value="10" /></label>
      <label>cluster <input id="cluster" type="range" min="0" max="100" step="1" value="20" /></label>
      <label>proud <input id="proud" type="range" min="0" max="100" step="1" value="35" /></label>
      <label>body opacity <input id="bodyOpacity" type="range" min="0" max="100" step="1" value="100" /></label>
```

- [ ] **Step 2: Register them in the hash**

In `apps/lab/src/main.ts`, add every new id to `CONTROL_IDS` after `'density'`:

```ts
  'radius',
  'tubeAt',
  'count',
  'chunkSize',
  'align',
  'cluster',
  'proud',
  'bodyOpacity',
```

- [ ] **Step 3: Feed them into the chosen look**

Replace `chosenLook()` with a version that layers decoration overrides on top of the flake ones it already applies:

```ts
function chosenLook(): Look {
  const name = look.get();
  const spec = specOf(name);
  const tuned: LookSpec = { ...spec };

  if (spec.flake) {
    tuned.flake = { ...spec.flake, size: 1 / number('grain'), density: number('density') / 100 };
  }

  if (spec.opacity !== undefined) tuned.opacity = number('bodyOpacity') / 100;

  const decoration = spec.decoration;
  if (decoration?.kind === 'tube') {
    tuned.decoration = {
      ...decoration,
      radius: number('radius') / 1000,
      at: [number('tubeAt') / 100],
    };
  } else if (decoration?.kind === 'chunks') {
    tuned.decoration = {
      ...decoration,
      count: number('count'),
      size: number('chunkSize') / 1000,
      align: number('align') / 100,
      cluster: number('cluster') / 100,
      proud: number('proud') / 100,
    };
  }

  return spec.flake || spec.decoration || spec.opacity !== undefined ? tuned : name;
}
```

- [ ] **Step 4: Seed the sliders from the chosen look**

Extend `seedFlakeSliders()` — rename it `seedSliders()` and update its two call sites — so decoration sliders start at the look's own values rather than at whatever the previous look left:

```ts
function seedSliders(): void {
  const spec = specOf(look.get());

  if (spec.flake) {
    grainInput.min = spec.flake.bump ? '1' : '20';
    grainInput.max = spec.flake.bump ? '24' : '400';
    grainInput.value = String(Math.round(1 / spec.flake.size));
    densityInput.value = String(Math.round(spec.flake.density * 100));
  }

  el<HTMLInputElement>('bodyOpacity').value = String(Math.round((spec.opacity ?? 1) * 100));

  const decoration = spec.decoration;
  if (decoration?.kind === 'tube') {
    el<HTMLInputElement>('radius').value = String(Math.round(decoration.radius * 1000));
    el<HTMLInputElement>('tubeAt').value = String(Math.round((decoration.at[0] ?? 1) * 100));
  } else if (decoration?.kind === 'chunks') {
    el<HTMLInputElement>('count').value = String(decoration.count);
    el<HTMLInputElement>('chunkSize').value = String(Math.round(decoration.size * 1000));
    el<HTMLInputElement>('align').value = String(Math.round(decoration.align * 100));
    el<HTMLInputElement>('cluster').value = String(Math.round(decoration.cluster * 100));
    el<HTMLInputElement>('proud').value = String(Math.round(decoration.proud * 100));
  }
}
```

- [ ] **Step 5: Grey out what the look does not read**

Extend the disabling block at line 297 so a live slider never does nothing:

```ts
  const spec = specOf(look.get());
  grainInput.disabled = densityInput.disabled = spec.flake === undefined;
  const tube = spec.decoration?.kind === 'tube';
  const chunks = spec.decoration?.kind === 'chunks';
  el<HTMLInputElement>('radius').disabled = el<HTMLInputElement>('tubeAt').disabled = !tube;
  for (const id of ['count', 'chunkSize', 'align', 'cluster', 'proud']) {
    el<HTMLInputElement>(id).disabled = !chunks;
  }
```

- [ ] **Step 6: Verify by eye**

Run: `npm run dev -w @blitsklieg/lab`
Open http://localhost:5180, pick each of `tubing`, `piping`, `sequin`, `pyrite`, and fire. Confirm each renders a visible decoration and that dragging each enabled slider changes it.

**This is the tuning step.** The preset numbers in Task 8 are starting points. Adjust them in `LOOKS` until each look reads right, then re-run `npm run check`.

- [ ] **Step 7: Commit**

```bash
git add apps/lab/index.html apps/lab/src/main.ts packages/core/src/render/looks.ts
git commit -m "unlock the decoration sliders and seed them per look"
```

---

## Task 11: Visual baselines

**Files:**
- Modify: `apps/lab/test/looks.spec.ts`

- [ ] **Step 1: Add a case per new look**

`apps/lab/test/looks.spec.ts` already screenshots one frame per look. Add `tubing`, `piping`, `sequin` and `pyrite` to whatever list drives it — read the file and follow the existing pattern exactly rather than inventing a new one.

- [ ] **Step 2: Record the baselines**

Run: `npm run test:visual -- --update-snapshots -g 'tubing|piping|sequin|pyrite'`
Expected: four new `look-<name>-darwin.png` files under `apps/lab/test/looks.spec.ts-snapshots/`.

- [ ] **Step 3: Look at them**

Run: `open apps/lab/test/looks.spec.ts-snapshots/look-tubing-darwin.png apps/lab/test/looks.spec.ts-snapshots/look-piping-darwin.png apps/lab/test/looks.spec.ts-snapshots/look-sequin-darwin.png apps/lab/test/looks.spec.ts-snapshots/look-pyrite-darwin.png`

A baseline recorded from a broken render locks the breakage in. Confirm each shows what its name claims before committing. **If `tubing` reads weak**, that is the bloom-width question the spec left open — record it as a finding, do not widen the chain inside this plan.

- [ ] **Step 4: Verify the whole suite**

Run: `npm run check && npm run test:visual`
Expected: all pass, including the nine pre-existing look baselines. **A changed baseline for an existing look is a regression, not an update** — the four new looks must not move `gold` or `glitter`.

- [ ] **Step 5: Commit**

```bash
git add apps/lab/test/looks.spec.ts apps/lab/test/looks.spec.ts-snapshots
git commit -m "pin the four decoration looks with visual baselines"
```

---

## Task 12: Release

**Files:**
- Modify: `CHANGELOG.md`, `packages/core/package.json`

- [ ] **Step 1: Write the changelog entry**

Add a `0.4.0` section to `CHANGELOG.md` in the style of the existing entries: the four new looks, the `opacity`/`tintTo`/`decoration` fields on `LookSpec`, and the per-letter material change with its consequence — a staggered enter now fades each letter on its own schedule rather than to the leading letter.

- [ ] **Step 2: Bump the version**

Set `packages/core/package.json` version to `0.4.0`. Every new field is optional and `Word` is not public, so this is a minor.

- [ ] **Step 3: Verify and commit**

Run: `npm run check && npm run test:visual`
Expected: all pass.

```bash
git add CHANGELOG.md packages/core/package.json package-lock.json
git commit -m "release blitsklieg 0.4.0"
```

---

## Self-Review Notes

**Spec coverage.** Every section of the design maps to a task: material model → 1, 2, 3; plumbing → 7; tube generator → 4; chunks generator → 5; types → 3, 5, 6; opacity → 3; tint → 6, 8; where the numbers come from → 10; testing → the test steps throughout plus 11.

**Two things the spec asserts that this plan does not yet prove.** `GlyphCache` is typed `<T extends Buildable>` where `Buildable` requires `dispose()`; `ChunkBlueprint.dispose()` is an empty function purely to satisfy that bound, which is honest but worth revisiting if a third blueprint kind appears. And Task 7 passes the cached body geometry into `buildChunkBlueprint` via a cast, because `GlyphCache`'s default type parameter is `THREE.ExtrudeGeometry` while the sampler wants `BufferGeometry` — if that cast fights the compiler, widen `Word`'s body cache to `GlyphCache<THREE.ExtrudeGeometry>` explicitly rather than casting at the call site.

**Deferred by the spec, out of scope here:** per-letter color and styled text runs, merging a letter's tube loops into one buffer, widening the bloom chain, medial-axis centerline.
