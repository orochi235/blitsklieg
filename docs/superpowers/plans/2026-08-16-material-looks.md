# Material Looks 0.3.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six looks — `gem` (renaming `ruby`), `velvet`, `neon`, `flake`, `glitter`, `leather` — and an open `LookSpec` type that lets a caller describe a material in plain numbers without importing three.

**Architecture:** Everything lives in `packages/core/src/render/looks.ts`. `LookParams` grows to cover three's sheen, anisotropy, dispersion and emissive channels; three of the new looks share one `onBeforeCompile` patch that hashes object-space position into flake cells. `Word` gains a per-letter seed uniform so letters don't sparkle in lockstep.

**Tech Stack:** TypeScript, three.js `>=0.185`, Vitest (no WebGL context), Playwright for visual checks, Biome for lint.

**Spec:** `docs/superpowers/specs/2026-08-16-material-looks-design.md`

**Verification note:** GLSL correctness cannot be unit-tested — Vitest has no GL context. Unit tests pin *structure*: uniforms exist, the chunk is injected, values arrive from the look. Appearance is verified by Playwright screenshots in Task 13. Do not fake a GL context to test shading.

---

### Task 1: Widen `LookParams` to the unused material channels

**Files:**
- Modify: `packages/core/src/render/looks.ts:6-41`
- Test: `packages/core/test/render/looks.test.ts:11-27`

- [ ] **Step 1: Write the failing test**

In `packages/core/test/render/looks.test.ts`, extend `KEY_SET` with the eight new keys:

```ts
const KEY_SET: Record<keyof LookParams, true> = {
  color: true,
  metalness: true,
  roughness: true,
  clearcoat: true,
  clearcoatRoughness: true,
  transmission: true,
  thickness: true,
  ior: true,
  attenuationColor: true,
  attenuationDistance: true,
  iridescence: true,
  iridescenceIOR: true,
  iridescenceThicknessRange: true,
  sheen: true,
  sheenColor: true,
  sheenRoughness: true,
  anisotropy: true,
  anisotropyRotation: true,
  dispersion: true,
  emissive: true,
  emissiveIntensity: true,
};
```

Then add this test inside `describe('applyLook')`:

```ts
it('resets every new channel from the defaults', () => {
  const gold = withLook('gold');
  expect(gold.sheen).toBe(0);
  expect(gold.sheenRoughness).toBe(1);
  expect(gold.sheenColor.getHex()).toBe(0xffffff);
  expect(gold.anisotropy).toBe(0);
  expect(gold.anisotropyRotation).toBe(0);
  expect(gold.dispersion).toBe(0);
  expect(gold.emissive.getHex()).toBe(0x000000);
  expect(gold.emissiveIntensity).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/looks.test.ts`
Expected: FAIL — TypeScript rejects the unknown keys in `KEY_SET`, and the `COLOR_KEYS` test fails because `emissive` and `sheenColor` are Color-valued but absent from `COLOR_KEYS`.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/render/looks.ts`, add the eight names to the `LookKey` union:

```ts
type LookKey = Extract<
  keyof THREE.MeshPhysicalMaterial,
  | 'color'
  | 'metalness'
  | 'roughness'
  | 'clearcoat'
  | 'clearcoatRoughness'
  | 'transmission'
  | 'thickness'
  | 'ior'
  | 'attenuationColor'
  | 'attenuationDistance'
  | 'iridescence'
  | 'iridescenceIOR'
  | 'iridescenceThicknessRange'
  | 'sheen'
  | 'sheenColor'
  | 'sheenRoughness'
  | 'anisotropy'
  | 'anisotropyRotation'
  | 'dispersion'
  | 'emissive'
  | 'emissiveIntensity'
>;
```

Extend `DEFAULTS` with three's own defaults for each:

```ts
const DEFAULTS: LookParams = {
  color: 0xffffff,
  metalness: 0,
  roughness: 0.2,
  clearcoat: 1,
  clearcoatRoughness: 0.06,
  transmission: 0,
  thickness: 0,
  ior: 1.5,
  attenuationColor: 0xffffff,
  attenuationDistance: Number.POSITIVE_INFINITY,
  iridescence: 0,
  iridescenceIOR: 1.3,
  iridescenceThicknessRange: [100, 400],
  sheen: 0,
  sheenColor: 0xffffff,
  sheenRoughness: 1,
  anisotropy: 0,
  anisotropyRotation: 0,
  dispersion: 0,
  emissive: 0x000000,
  emissiveIntensity: 1,
};
```

Extend `COLOR_KEYS`:

```ts
export const COLOR_KEYS = new Set<LookKey>([
  'color',
  'attenuationColor',
  'sheenColor',
  'emissive',
]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/render/looks.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/looks.ts packages/core/test/render/looks.test.ts
git commit -m "widen look params to sheen, anisotropy, dispersion and emissive"
```

---

### Task 2: Rename `ruby` to `gem` and give it dispersion

Breaking change. No alias — `ruby` stops existing.

**Files:**
- Modify: `packages/core/src/render/looks.ts:3,59-83`
- Modify: `packages/core/src/index.ts:88-90`
- Modify: `packages/core/test/render/looks.test.ts:28,90-153`
- Modify: `packages/core/test/index.test.ts:630`

- [ ] **Step 1: Write the failing test**

In `looks.test.ts`, change the names list and the two `ruby` tests:

```ts
const NAMES: LookName[] = ['gold', 'chrome', 'oil', 'gem'];
```

```ts
it('leaves no transmission, thickness or attenuation behind when gem is replaced', () => {
  const material = withLook('gem');
  expect(material.transmission).toBe(1);
  expect(material.thickness).toBe(1.4);
  expect(material.attenuationDistance).toBe(0.6);

  applyLook(material, 'gold');
  expect(material.transmission).toBe(0);
  expect(material.thickness).toBe(0);
  expect(material.attenuationDistance).toBe(Number.POSITIVE_INFINITY);
  expect(material.attenuationColor.getHex()).toBe(0xffffff);
  expect(material.dispersion).toBe(0);
});
```

Replace the other three `'ruby'` occurrences (lines 113, 138, and the `recolors ruby` test at 153) with `'gem'`, renaming that test to `recolors gem through attenuation, which is where its hue actually lives`.

Add a dispersion test inside `describe('LOOKS')`:

```ts
it('gives gem dispersion, which is what separates a stone from red glass', () => {
  expect(withLook('gem').dispersion).toBeGreaterThan(0);
});
```

In `packages/core/test/index.test.ts:630`:

```ts
expect(LOOK_NAMES).toEqual(['gold', 'chrome', 'oil', 'gem']);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/test`
Expected: FAIL — `'gem'` is not assignable to `LookName`.

- [ ] **Step 3: Write minimal implementation**

In `looks.ts`, rename in the union:

```ts
export type LookName = 'gold' | 'chrome' | 'oil' | 'gem';
```

Rename the `LOOKS` entry and add dispersion:

```ts
  gem: {
    color: 0xffffff,
    roughness: 0.06,
    transmission: 1,
    thickness: 1.4,
    ior: 2.2,
    attenuationColor: 0xd4143c,
    attenuationDistance: 0.6,
    clearcoatRoughness: 0.03,
    dispersion: 4,
  },
```

Rename the `HUE_KEY` entry (`ruby: 'attenuationColor'` becomes `gem: 'attenuationColor'`) and update its docstring to say `gem` instead of `ruby`. Task 5 replaces this record entirely; renaming it here keeps the tree compiling.

In `packages/core/src/index.ts:88-90`, update the `tint` docstring:

```ts
  /**
   * Recolors the look, as `0xff2d6f`. Routed to whichever property carries that look's hue —
   * `gem` is clear stone whose red comes from what light picks up passing through it, so
   * tinting its base color would do nothing.
   */
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test && npm run typecheck`
Expected: PASS, and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "rename the ruby look to gem and give it dispersion"
```

---

### Task 3: Add the `velvet` look

**Files:**
- Modify: `packages/core/src/render/looks.ts:3,45-69`
- Modify: `packages/core/test/render/looks.test.ts:28`
- Modify: `packages/core/test/index.test.ts:630`

- [ ] **Step 1: Write the failing test**

In `looks.test.ts`, add `'velvet'` to `NAMES`:

```ts
const NAMES: LookName[] = ['gold', 'chrome', 'oil', 'gem', 'velvet'];
```

Add inside `describe('LOOKS')`:

```ts
it('gives velvet a sheen lobe and no clearcoat, since a coat flattens the nap', () => {
  const velvet = withLook('velvet');
  expect(velvet.sheen).toBe(1);
  expect(velvet.clearcoat).toBe(0);
  expect(velvet.metalness).toBe(0);
  expect(velvet.roughness).toBeGreaterThan(0.8);
});
```

In `index.test.ts:630`:

```ts
expect(LOOK_NAMES).toEqual(['gold', 'chrome', 'oil', 'gem', 'velvet']);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/test`
Expected: FAIL — `'velvet'` is not assignable to `LookName`.

- [ ] **Step 3: Write minimal implementation**

In `looks.ts`, add to the union and to `LOOKS` after `gem`:

```ts
export type LookName = 'gold' | 'chrome' | 'oil' | 'gem' | 'velvet';
```

```ts
  velvet: {
    color: 0x7a1030,
    metalness: 0,
    roughness: 0.95,
    // A clearcoat sits above the nap and mirrors over it; sheen needs it off.
    clearcoat: 0,
    sheen: 1,
    sheenColor: 0xff6ea8,
    sheenRoughness: 0.35,
  },
```

Add `velvet: 'color'` to `HUE_KEY`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "add the velvet look"
```

---

### Task 4: Add the `neon` look

**Files:**
- Modify: `packages/core/src/render/looks.ts:3,45-69`
- Modify: `packages/core/test/render/looks.test.ts:28`
- Modify: `packages/core/test/index.test.ts:630`

- [ ] **Step 1: Write the failing test**

In `looks.test.ts`, add `'neon'` to `NAMES` and add inside `describe('LOOKS')`:

```ts
it('gives neon an emissive above the bloom threshold over a near-black base', () => {
  const neon = withLook('neon');
  expect(neon.emissive.getHex()).not.toBe(0x000000);
  expect(neon.emissiveIntensity).toBeGreaterThan(1);
  expect(neon.clearcoat).toBe(0);
});
```

In `index.test.ts:630`:

```ts
expect(LOOK_NAMES).toEqual(['gold', 'chrome', 'oil', 'gem', 'velvet', 'neon']);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/test`
Expected: FAIL — `'neon'` is not assignable to `LookName`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type LookName = 'gold' | 'chrome' | 'oil' | 'gem' | 'velvet' | 'neon';
```

```ts
  neon: {
    color: 0x120018,
    metalness: 0,
    roughness: 0.4,
    clearcoat: 0,
    emissive: 0xff2d95,
    emissiveIntensity: 3.2,
  },
```

Add `neon: 'emissive'` to `HUE_KEY`. Widen its type to include `'emissive'`:

```ts
const HUE_KEY: Record<LookName, 'color' | 'attenuationColor' | 'emissive'> = {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "add the neon look"
```

---

### Task 5: Replace `HUE_KEY` with inferred tint targeting

`HUE_KEY` is a record enumerated over built-in names. A caller's spec (Task 6) is not in it, so the routing becomes a rule that reads the resolved params.

**Files:**
- Modify: `packages/core/src/render/looks.ts:71-83,93-109`
- Test: `packages/core/test/render/looks.test.ts` (new `describe`)

- [ ] **Step 1: Write the failing test**

Add to `looks.test.ts`, importing `tintTargetOf` and `type TintTarget` from `../../src/render/looks.js`:

```ts
describe('tintTargetOf', () => {
  it('routes a transmissive look to attenuation, where its hue actually lives', () => {
    expect(tintTargetOf({ ...DEFAULT_PARAMS, transmission: 1 })).toBe('attenuationColor');
  });

  it('routes an emissive look to its emissive', () => {
    expect(tintTargetOf({ ...DEFAULT_PARAMS, emissive: 0xff2d95 })).toBe('emissive');
  });

  it('routes everything else to the base color', () => {
    expect(tintTargetOf({ ...DEFAULT_PARAMS, metalness: 1 })).toBe('color');
  });

  it('never infers sheenColor: a velvet reads by its body, not its highlight', () => {
    expect(tintTargetOf({ ...DEFAULT_PARAMS, sheen: 1 })).toBe('color');
  });

  it('lets a declared target win over every inference', () => {
    const declared: TintTarget = 'sheenColor';
    expect(tintTargetOf({ ...DEFAULT_PARAMS, transmission: 1 }, declared)).toBe('sheenColor');
  });
});
```

`DEFAULTS` is already the source of truth, so the test imports it rather than rebuilding it. Export it from `looks.ts` in Step 3 and add it to this file's import list:

```ts
import {
  applyLook,
  COLOR_KEYS,
  createMaterial,
  DEFAULTS as DEFAULT_PARAMS,
  LOOKS,
  type LookName,
  type LookParams,
  type TintTarget,
  tintTargetOf,
} from '../../src/render/looks.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/looks.test.ts`
Expected: FAIL — `tintTargetOf` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `looks.ts`, export `DEFAULTS`, delete `HUE_KEY` entirely, and add:

```ts
export type TintTarget = 'color' | 'attenuationColor' | 'emissive' | 'sheenColor';

/**
 * Which property carries a look's hue. Not always `color`: `gem` is clear stone at
 * `color: 0xffffff` and its red is what light picks up passing through it, and `neon` is a
 * near-black body whose color is entirely its emissive. `sheenColor` is reachable only by
 * declaring it — a velvet reads by its body, and tinting only the highlight would answer
 * "make it red" with red-lit maroon.
 */
export function tintTargetOf(params: LookParams, declared?: TintTarget): TintTarget {
  if (declared) return declared;
  if (params.transmission > 0) return 'attenuationColor';
  if (params.emissive !== 0x000000) return 'emissive';
  return 'color';
}
```

Rewrite the tint line in `applyLook`:

```ts
  const params = { ...DEFAULTS, ...LOOKS[name] };
  if (tint !== undefined) params[tintTargetOf(params)] = tint;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test && npm run typecheck`
Expected: PASS. The existing `changes exactly one channel` test still holds for every built-in.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "infer the tint target from resolved params instead of a name record"
```

---

### Task 6: Accept a `LookSpec` alongside a name

**Files:**
- Modify: `packages/core/src/render/looks.ts`
- Test: `packages/core/test/render/looks.test.ts` (new `describe`)

- [ ] **Step 1: Write the failing test**

```ts
describe('LookSpec', () => {
  it('applies a caller spec the same way a built-in name is applied', () => {
    const material = createMaterial();
    applyLook(material, { metalness: 1, roughness: 0.5, color: 0x00ff00 });

    expect(material.metalness).toBe(1);
    expect(material.roughness).toBe(0.5);
    expect(material.color.getHex()).toBe(0x00ff00);
  });

  it('fills the rest of a spec from the defaults', () => {
    const material = createMaterial();
    applyLook(material, { metalness: 1 });

    expect(material.clearcoat).toBe(1);
    expect(material.transmission).toBe(0);
    expect(material.sheen).toBe(0);
  });

  it('clamps an out-of-range value rather than throwing mid-effect', () => {
    const material = createMaterial();
    applyLook(material, { roughness: 40, metalness: -3 });

    expect(material.roughness).toBe(1);
    expect(material.metalness).toBe(0);
  });

  it('ignores a key that is not a material param', () => {
    const material = createMaterial();
    expect(() =>
      applyLook(material, { metalness: 1, nonsense: 7 } as unknown as LookSpec),
    ).not.toThrow();
    expect(material.metalness).toBe(1);
  });

  it('honors a declared tint target on a spec', () => {
    const material = createMaterial();
    applyLook(material, { sheen: 1, tintTarget: 'sheenColor' }, 0x00ff00);

    expect(material.sheenColor.getHex()).toBe(0x00ff00);
    expect(material.color.getHex()).toBe(0xffffff);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/looks.test.ts`
Expected: FAIL — `applyLook` does not accept an object, and `LookSpec` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `looks.ts`:

```ts
export interface LookSpec extends Partial<LookParams> {
  tintTarget?: TintTarget;
  /** Turns the bloom pass on for this look unless the caller says otherwise. */
  bloom?: boolean;
}

export type Look = LookName | LookSpec;

const RANGES: Partial<Record<LookKey, [number, number]>> = {
  metalness: [0, 1],
  roughness: [0, 1],
  clearcoat: [0, 1],
  clearcoatRoughness: [0, 1],
  transmission: [0, 1],
  iridescence: [0, 1],
  sheen: [0, 1],
  sheenRoughness: [0, 1],
  anisotropy: [0, 1],
  thickness: [0, Number.POSITIVE_INFINITY],
  attenuationDistance: [0, Number.POSITIVE_INFINITY],
  emissiveIntensity: [0, Number.POSITIVE_INFINITY],
  ior: [1, 2.333],
  iridescenceIOR: [1, 5],
  dispersion: [0, 10],
};

const PARAM_KEYS = Object.keys(DEFAULTS) as LookKey[];

export function specOf(look: Look): LookSpec {
  return typeof look === 'string' ? LOOKS[look] : look;
}

function resolveParams(spec: LookSpec): LookParams {
  const params = { ...DEFAULTS };
  for (const key of PARAM_KEYS) {
    const value = spec[key];
    if (value === undefined) continue;
    const range = RANGES[key];
    (params[key] as unknown) =
      range && typeof value === 'number'
        ? Math.min(Math.max(value, range[0]), range[1])
        : value;
  }
  return params;
}
```

Rewrite `applyLook` in full. The write loop now walks `PARAM_KEYS` rather than `Object.keys(params)`, which is what keeps an unknown key from reaching the material:

```ts
export function applyLook(
  material: THREE.MeshPhysicalMaterial,
  look: Look,
  tint?: number,
): void {
  const spec = specOf(look);
  const params = resolveParams(spec);
  if (tint !== undefined) params[tintTargetOf(params, spec.tintTarget)] = tint;
  const target = material as unknown as Record<string, unknown>;

  for (const key of PARAM_KEYS) {
    const value = params[key];
    if (COLOR_KEYS.has(key)) (material[key] as THREE.Color).set(value as number);
    else if (Array.isArray(value)) target[key] = [...value];
    else target[key] = value;
  }
  material.needsUpdate = true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "accept a plain-number LookSpec anywhere a look name works"
```

---

### Task 7: Thread `Look` through the public API

**Files:**
- Modify: `packages/core/src/index.ts:9,36,85`
- Modify: `packages/core/src/render/word.ts:7,32`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `index.test.ts`, in a new `describe('caller-supplied looks')`:

```ts
it('fires with a spec in place of a name', async () => {
  const bk = createKlieg({ fontUrl: FONT_URL, clock });
  await expect(
    bk.fire('HI', { look: { metalness: 1, roughness: 0.3 }, hold: 0 }),
  ).resolves.toBeUndefined();
  bk.destroy();
});
```

Match the surrounding tests' harness for `FONT_URL` and `clock` — copy the setup used by the existing `caller-supplied motion` describe rather than inventing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/index.test.ts`
Expected: FAIL — `look` accepts only `LookName`.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/index.ts`, widen the import and the option, and export the new types:

```ts
import { LOOKS, type Look, type LookName, type LookSpec } from './render/looks.js';
```

```ts
export type { ActiveName, Clock, EnterName, ExitName, Look, LookName, LookSpec, QueuePolicy };
export type { TintTarget } from './render/looks.js';
```

```ts
  look?: Look;
```

In `packages/core/src/render/word.ts`, widen the constructor parameter:

```ts
import { applyLook, createMaterial, type Look } from './looks.js';
```

```ts
    look: Look,
```

`LOOK_NAMES` stays derived from `LOOKS` and continues to list names only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: lint, typecheck and tests all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "let fire() take a look spec as well as a look name"
```

---

### Task 8: Let a look request the bloom pass

`neon` is flat without bloom, and `bloom` is opt-in per `fire()`. An explicit `bloom` on `FireOptions` wins in both directions.

**Files:**
- Modify: `packages/core/src/render/looks.ts` (`neon` entry)
- Modify: `packages/core/src/index.ts:140`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

In `looks.test.ts`:

```ts
it('has neon request bloom, which it is flat without', () => {
  expect(specOf('neon').bloom).toBe(true);
  expect(specOf('gold').bloom).toBeUndefined();
});
```

In `index.test.ts`, add a unit test for the resolution rule by exporting the helper:

```ts
describe('wantsBloom', () => {
  it('turns bloom on for a look that asks for it', () => {
    expect(wantsBloom(undefined, 'neon')).toBe(true);
  });

  it('lets an explicit false override the look', () => {
    expect(wantsBloom(false, 'neon')).toBe(false);
  });

  it('lets an explicit true override a look that never asked', () => {
    expect(wantsBloom(true, 'gold')).toBe(true);
  });

  it('stays off by default', () => {
    expect(wantsBloom(undefined, 'gold')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/test`
Expected: FAIL — `wantsBloom` is not exported and `neon` has no `bloom` field.

- [ ] **Step 3: Write minimal implementation**

Add `bloom: true` to the `neon` entry in `LOOKS`.

In `packages/core/src/index.ts`, add and export:

```ts
/** An explicit `bloom` always wins; a look may only ask when the caller said nothing. */
export function wantsBloom(explicit: boolean | undefined, look: Look): boolean {
  return explicit ?? specOf(look).bloom ?? false;
}
```

Change line 140 from `opts.bloom ? new BloomPath(renderer) : null` to:

```ts
    const bloom = wantsBloom(opts.bloom, opts.look ?? 'gold') ? new BloomPath(renderer) : null;
```

Import `specOf` alongside `LOOKS`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "let a look request the bloom pass, with fire() still winning"
```

---

### Task 9: The flake shader patch

One `onBeforeCompile` patch, always injected and gated on `uFlakeDensity > 0`, so a look switch never needs a recompile and there is one program variant for every look.

**Files:**
- Create: `packages/core/src/render/flake.ts`
- Create: `packages/core/test/render/flake.test.ts`
- Modify: `packages/core/src/render/looks.ts` (`createMaterial`, `applyLook`)

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/render/flake.test.ts`:

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createFlakeUniforms, patchForFlakes } from '../../src/render/flake.js';

function stubShader() {
  return {
    vertexShader: '#include <begin_vertex>\nvoid main(){}',
    fragmentShader: '#include <normal_fragment_maps>\n#include <color_fragment>\nvoid main(){}',
    uniforms: {} as Record<string, THREE.IUniform>,
  };
}

describe('createFlakeUniforms', () => {
  it('starts disabled, so a look that declares no flakes costs nothing but a branch', () => {
    const u = createFlakeUniforms();
    expect(u.uFlakeDensity.value).toBe(0);
  });

  it('gives each material its own uniform objects', () => {
    expect(createFlakeUniforms().uSeed).not.toBe(createFlakeUniforms().uSeed);
  });
});

describe('patchForFlakes', () => {
  it('installs the uniform objects the material already owns, not copies', () => {
    const u = createFlakeUniforms();
    const shader = stubShader();
    patchForFlakes(shader, u);

    expect(shader.uniforms.uFlakeDensity).toBe(u.uFlakeDensity);
    expect(shader.uniforms.uSeed).toBe(u.uSeed);
  });

  it('carries object-space position through to the fragment stage', () => {
    const shader = stubShader();
    patchForFlakes(shader, createFlakeUniforms());

    expect(shader.vertexShader).toContain('varying vec3 vFlakePos');
    expect(shader.vertexShader).toContain('vFlakePos = transformed');
    expect(shader.fragmentShader).toContain('varying vec3 vFlakePos');
  });

  it('gates the whole chunk on density, so one program serves every look', () => {
    const shader = stubShader();
    patchForFlakes(shader, createFlakeUniforms());

    expect(shader.fragmentShader).toContain('uFlakeDensity > 0.0');
  });

  it('keeps the three chunks it patches into', () => {
    const shader = stubShader();
    patchForFlakes(shader, createFlakeUniforms());

    expect(shader.vertexShader).toContain('#include <begin_vertex>');
    expect(shader.fragmentShader).toContain('#include <normal_fragment_maps>');
    expect(shader.fragmentShader).toContain('#include <color_fragment>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/flake.test.ts`
Expected: FAIL — `packages/core/src/render/flake.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/render/flake.ts`:

```ts
import * as THREE from 'three';

export interface FlakeSpec {
  /** Fraction of cells that are flakes, 0..1. Zero disables the chunk. */
  density: number;
  /** Cell edge in object-space units — glyphs are built at 1 em. */
  size: number;
  /** How far a flake normal tilts off the surface, 0..1. */
  spread: number;
  color?: number;
  /** Smooth rounded cells (leather grain) instead of flat random facets. */
  bump?: boolean;
}

export interface FlakeUniforms {
  uFlakeDensity: THREE.IUniform<number>;
  uFlakeSize: THREE.IUniform<number>;
  uFlakeSpread: THREE.IUniform<number>;
  uFlakeBump: THREE.IUniform<number>;
  uFlakeColor: THREE.IUniform<THREE.Color>;
  uSeed: THREE.IUniform<number>;
}

export function createFlakeUniforms(): FlakeUniforms {
  return {
    uFlakeDensity: { value: 0 },
    uFlakeSize: { value: 0.02 },
    uFlakeSpread: { value: 0.4 },
    uFlakeBump: { value: 0 },
    uFlakeColor: { value: new THREE.Color(0xffffff) },
    uSeed: { value: 0 },
  };
}

export function writeFlakeUniforms(u: FlakeUniforms, spec: FlakeSpec | undefined): void {
  u.uFlakeDensity.value = spec ? spec.density : 0;
  if (!spec) return;
  u.uFlakeSize.value = spec.size;
  u.uFlakeSpread.value = spec.spread;
  u.uFlakeBump.value = spec.bump ? 1 : 0;
  u.uFlakeColor.value.set(spec.color ?? 0xffffff);
}

const COMMON = /* glsl */ `
uniform float uFlakeDensity;
uniform float uFlakeSize;
uniform float uFlakeSpread;
uniform float uFlakeBump;
uniform vec3  uFlakeColor;
uniform float uSeed;
varying vec3 vFlakePos;
`;

const HASH = /* glsl */ `
vec3 bkHash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}
`;

// Sub-pixel flakes strobe under minification. Contrast fades and roughness widens as a cell
// approaches one pixel, so distant type goes evenly rough instead of boiling.
const PERTURB = /* glsl */ `
if (uFlakeDensity > 0.0) {
  vec3 bkCoord = vFlakePos / uFlakeSize + uSeed;
  vec3 bkCell = floor(bkCoord);
  vec3 bkRnd = bkHash3(bkCell);
  float bkIsFlake = step(1.0 - uFlakeDensity, bkRnd.x * 0.5 + 0.5);
  float bkFade = 1.0 - smoothstep(0.35, 1.0, fwidth(length(bkCoord)));

  vec3 bkFacet = bkRnd;
  vec3 bkLocal = fract(bkCoord) - 0.5;
  vec3 bkDome = normalize(vec3(bkLocal.xy * 2.0, 0.6));
  vec3 bkOffset = mix(bkFacet, bkDome, uFlakeBump);

  normal = normalize(normal + bkOffset * uFlakeSpread * bkIsFlake * bkFade);
  roughnessFactor = clamp(roughnessFactor + (1.0 - bkFade) * 0.25, 0.0, 1.0);
}
`;

const TINT = /* glsl */ `
if (uFlakeDensity > 0.0) {
  vec3 bkCell = floor(vFlakePos / uFlakeSize + uSeed);
  float bkIsFlake = step(1.0 - uFlakeDensity, bkHash3(bkCell).x * 0.5 + 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, uFlakeColor, bkIsFlake * 0.6);
}
`;

export interface PatchableShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
}

export function patchForFlakes(shader: PatchableShader, uniforms: FlakeUniforms): void {
  Object.assign(shader.uniforms, uniforms);

  shader.vertexShader = `varying vec3 vFlakePos;\n${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\nvFlakePos = transformed;',
  );

  shader.fragmentShader = `${COMMON}${HASH}${shader.fragmentShader}`
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${PERTURB}`)
    .replace('#include <color_fragment>', `#include <color_fragment>${TINT}`);
}
```

In `looks.ts`, own the uniforms on the material and always install the patch:

```ts
export function createMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ envMapIntensity: 2.2 });
  const uniforms = createFlakeUniforms();
  material.userData.flake = uniforms;
  material.onBeforeCompile = (shader) => patchForFlakes(shader, uniforms);
  return material;
}
```

At the end of `applyLook`, before `material.needsUpdate = true`:

```ts
  writeFlakeUniforms(material.userData.flake as FlakeUniforms, spec.flake);
```

Add `flake?: FlakeSpec` to `LookSpec`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "add the procedural flake shader patch"
```

---

### Task 10: Decorrelate the flake field per letter

`Word` shares one material across every letter and `GlyphCache` shares one geometry per `(char, depth)`, so object-space hashing alone gives every letter an identical field — the two `L`s in `HELLO` sparkle in lockstep, which reads as fake immediately.

**Files:**
- Modify: `packages/core/src/render/word.ts:78-80`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('flake seeding', () => {
  it('gives each letter its own seed, or repeated letters sparkle in lockstep', () => {
    const word = new Word('AA', stubFont(), 'flake', ROOMY);
    const seeds = word.group.children.map((mesh) => {
      mesh.onBeforeRender(
        null as never, null as never, null as never, null as never, null as never, null as never,
      );
      return (mesh as THREE.Mesh).material.userData.flake.uSeed.value as number;
    });

    expect(seeds[0]).not.toBe(seeds[1]);
  });

  it('forces the shared material to re-upload, or every letter draws the first seed', () => {
    const word = new Word('AB', stubFont(), 'flake', ROOMY);
    const mesh = word.group.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.MeshPhysicalMaterial;
    material.uniformsNeedUpdate = false;

    mesh.onBeforeRender(
      null as never, null as never, null as never, null as never, null as never, null as never,
    );

    expect(material.uniformsNeedUpdate).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: FAIL — every letter reports seed `0`.

- [ ] **Step 3: Write minimal implementation**

In `word.ts`, after `const mesh = new THREE.Mesh(geo, this.material);` (line 78):

```ts
        // One material and one geometry are shared across letters, so the only per-letter
        // channel left is a uniform forced to re-upload on each draw.
        const seed = this.letters.length * 17.13;
        mesh.onBeforeRender = () => {
          const flake = this.material.userData.flake as FlakeUniforms;
          flake.uSeed.value = seed;
          this.material.uniformsNeedUpdate = true;
        };
```

Import `type FlakeUniforms` from `./flake.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "seed the flake field per letter so repeated letters differ"
```

---

### Task 11: Add the `flake`, `glitter` and `leather` looks

All three are the same shader with different constants.

**Files:**
- Modify: `packages/core/src/render/looks.ts`
- Modify: `packages/core/test/render/looks.test.ts:28`
- Modify: `packages/core/test/index.test.ts:630`

- [ ] **Step 1: Write the failing test**

```ts
const NAMES: LookName[] = [
  'gold', 'chrome', 'oil', 'gem', 'velvet', 'neon', 'flake', 'glitter', 'leather',
];
```

```ts
describe('flake looks', () => {
  it('gives glitter larger, wider-tilted cells than car-paint flake', () => {
    const flake = specOf('flake').flake as FlakeSpec;
    const glitter = specOf('glitter').flake as FlakeSpec;

    expect(glitter.size).toBeGreaterThan(flake.size);
    expect(glitter.spread).toBeGreaterThan(flake.spread);
  });

  it('makes leather the only one with rounded cells rather than facets', () => {
    expect((specOf('leather').flake as FlakeSpec).bump).toBe(true);
    expect((specOf('flake').flake as FlakeSpec).bump).toBeUndefined();
    expect((specOf('glitter').flake as FlakeSpec).bump).toBeUndefined();
  });

  it('leaves the flake uniforms disabled for a look that declares none', () => {
    const material = createMaterial();
    applyLook(material, 'glitter');
    expect(material.userData.flake.uFlakeDensity.value).toBeGreaterThan(0);

    applyLook(material, 'gold');
    expect(material.userData.flake.uFlakeDensity.value).toBe(0);
  });
});
```

In `index.test.ts:630`:

```ts
expect(LOOK_NAMES).toEqual([
  'gold', 'chrome', 'oil', 'gem', 'velvet', 'neon', 'flake', 'glitter', 'leather',
]);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/test`
Expected: FAIL — the three names are not assignable to `LookName`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type LookName =
  | 'gold' | 'chrome' | 'oil' | 'gem' | 'velvet' | 'neon' | 'flake' | 'glitter' | 'leather';
```

```ts
  flake: {
    color: 0x8a1c2b,
    metalness: 0.9,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    flake: { density: 0.35, size: 0.012, spread: 0.35, color: 0xffd9c0 },
  },
  glitter: {
    color: 0xf6f2ea,
    metalness: 0.25,
    roughness: 0.55,
    clearcoat: 0.4,
    clearcoatRoughness: 0.2,
    flake: { density: 0.6, size: 0.045, spread: 0.85, color: 0xff5ecb },
  },
  leather: {
    color: 0x5a2f1d,
    metalness: 0,
    roughness: 0.72,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
    sheen: 0.35,
    sheenColor: 0xd8a071,
    flake: { density: 1, size: 0.03, spread: 0.22, bump: true },
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "add the flake, glitter and leather looks"
```

---

### Task 12: Document the release

**Files:**
- Modify: `README.md:84-100,168`
- Modify: `CHANGELOG.md:1`
- Modify: `apps/lab/src/main.ts` (add the new looks to the picker)

- [ ] **Step 1: Update the look table in `README.md:84-87`**

```markdown
| `gold` | warm polished metal |
| `chrome` | near-white mirror metal |
| `oil` | dark iridescent thin film |
| `gem` | clear stone, lit through, dispersing to rainbow at the edges |
| `velvet` | deep matte nap, bright at grazing angles |
| `neon` | glowing tube-lit sign; turns bloom on by itself |
| `flake` | metallic car paint |
| `glitter` | craft glitter over glue |
| `leather` | pebbled hide |
```

- [ ] **Step 2: Update the tint prose at `README.md:95-100`**

Replace `ruby` with `gem` in both the example and the sentence explaining hue routing, then add the spec form below them. The block to append to the README (outer `~~~` here is only this plan's fence — the README gets a normal ```` ``` ```` js block):

~~~markdown
`look` also takes a plain object instead of a name, for a material of your own:

```js
await bk.fire('YOU WIN', { look: { metalness: 1, roughness: 0.3, color: 0x00e5ff } });
```

Every key is a number, so nothing about three appears in your types. `tintTarget` picks which
channel `tint` writes to when the default routing guesses wrong.
~~~

- [ ] **Step 3: Update `README.md:168`**

The `look` default row is unchanged (`'gold'`), but its type is now a name **or** a spec — say so in the cell.

- [ ] **Step 4: Add a 0.3.0 entry at the top of `CHANGELOG.md`**

```markdown
## 0.3.0

### Breaking

`ruby` is now `gem`, with no alias. It also gained `dispersion`, which splits transmitted
light into rainbow fringes at the edges — the reason the name changed.

### Six looks

`velvet` is a matte nap that lights up at grazing angles. `neon` glows, and turns the bloom
pass on by itself unless you pass `bloom: false`. `flake`, `glitter` and `leather` share one
procedural shader that hashes object-space position into cells: small tight facets for car
paint, large wide-tilted ones for craft glitter, rounded ones for hide.

### Materials of your own

`look` now takes a plain object as well as a name — every key a number, no three types in
your signatures. `tintTarget` overrides which channel `tint` writes to.
```

- [ ] **Step 5: Add the new looks to the lab picker**

In `apps/lab/src/main.ts`, extend whatever list drives the look control with the six new names. Read the file first; match its existing shape rather than assuming one.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md apps/lab/src/main.ts
git commit -m "document the 0.3.0 looks"
```

---

### Task 13: Visual verification

Appearance is the one thing the unit tests cannot reach.

**Files:**
- Create or modify: the Playwright spec covering looks (follow `playwright.config.ts` for the test directory)

- [ ] **Step 1: Add a screenshot case per look**

One `fire()` per look at a fixed clock value, screenshotting the canvas. Follow the existing visual spec's harness for clock control — the effect must be pinned to a deterministic frame or the shots will flake.

- [ ] **Step 2: Run the visual suite and generate baselines**

Run: `npm run test:visual`
Expected: nine new snapshots written on the first run.

- [ ] **Step 3: Inspect every baseline by eye**

Open each new snapshot. This is the acceptance gate for the shader — check specifically that:
- `flake` reads as car paint, not as noise
- `glitter` reads as discrete chunks, not as a rough surface
- `leather` reads as grain, not as facets
- repeated letters in a word do **not** sparkle identically
- `neon` glows without the caller passing `bloom: true`
- `gem` shows color fringing at the edges

If any of these fail, the constants in Task 11 are what to tune — not the shader structure.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "pin the nine looks with visual baselines"
```

---

---

### Task 14: Promote lighting to its own named option

`sweep` is an `active` piece that contributes no transform — it only sets `envRotation: true`. Its period is `slotDuration(active)`, a `Math.max` over the layers, so layering it under `float` stretches its tuned 3400ms to 5200ms.

**Files:**
- Create: `packages/core/src/render/lighting.ts`
- Modify: `packages/core/src/motion/active.ts` (drop `sweep`, drop `ENV_DRIVEN`)
- Modify: `packages/core/src/motion/types.ts` (`ActiveName` loses `'sweep'`)
- Modify: `packages/core/src/index.ts` (`lighting` option, `LIGHTING_NAMES`, env rotation)
- Test: `packages/core/test/render/lighting.test.ts`, `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/render/lighting.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LIGHTING, type LightingName, envRotationAt } from '../../src/render/lighting.js';

const NAMES: LightingName[] = ['sweep', 'static'];
const TAU = Math.PI * 2;

describe('LIGHTING', () => {
  it('has an entry for every name in the union', () => {
    expect(Object.keys(LIGHTING).sort()).toEqual([...NAMES].sort());
  });
});

describe('envRotationAt', () => {
  it('turns sweep a full rotation over its own period, not the active slot duration', () => {
    expect(envRotationAt('sweep', 0)).toBeCloseTo(0);
    expect(envRotationAt('sweep', LIGHTING.sweep.periodMs)).toBeCloseTo(TAU);
    expect(envRotationAt('sweep', LIGHTING.sweep.periodMs / 2)).toBeCloseTo(TAU / 2);
  });

  it('holds static still at every elapsed time', () => {
    expect(envRotationAt('static', 0)).toBe(0);
    expect(envRotationAt('static', 9999)).toBe(0);
  });

  it('keeps turning past one period rather than clamping', () => {
    expect(envRotationAt('sweep', LIGHTING.sweep.periodMs * 1.5)).toBeCloseTo(TAU * 1.5);
  });
});
```

In `packages/core/test/index.test.ts`, update the name list assertion and add the new one:

```ts
expect(ACTIVE_NAMES).toEqual(['float', 'pulse', 'shimmer', 'none']);
expect(LIGHTING_NAMES).toEqual(['sweep', 'static']);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/test`
Expected: FAIL — `packages/core/src/render/lighting.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/render/lighting.ts`:

```ts
export type LightingName = 'sweep' | 'static';

export interface LightingMode {
  /** Milliseconds for one full turn of the environment. Zero holds it still. */
  periodMs: number;
}

export const LIGHTING: Record<LightingName, LightingMode> = {
  sweep: { periodMs: 3400 },
  static: { periodMs: 0 },
};

const TAU = Math.PI * 2;

/** Effect-relative: absolute clock time would start every effect at an arbitrary angle. */
export function envRotationAt(name: LightingName, elapsed: number): number {
  const { periodMs } = LIGHTING[name];
  return periodMs > 0 ? (elapsed / periodMs) * TAU : 0;
}
```

In `packages/core/src/motion/active.ts`, delete the `sweep` constant, its `ACTIVE` entry, and the `ENV_DRIVEN` export.

In `packages/core/src/motion/types.ts`, remove `'sweep'` from `ActiveName`.

In `packages/core/src/index.ts`: add `lighting?: LightingName` to `FireOptions`, export `LIGHTING_NAMES` derived from `LIGHTING` the way the other lists are derived, change the active default from `'sweep'` to `'none'`, and replace the env-rotation line:

```ts
    stage.scene.environmentRotation.y = envRotationAt(opts.lighting ?? 'sweep', elapsed);
```

Delete the now-unused `envDriven` binding and the `slotDrivesEnv` import. Keep `slotDrivesEnv` exported from the compositor — `cycle({ envRotation: true })` stays public.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "promote lighting to its own option with sweep and static modes"
```

---

### Task 15: Document lighting

**Files:**
- Modify: `README.md` (options table, a lighting section)
- Modify: `CHANGELOG.md` (0.3.0 entry)

- [ ] **Step 1: Add `lighting` to the README options table**

A row reading `` `lighting` | `'sweep'` | how the environment lights the type ``, plus a short section naming the two modes and noting that `sweep` is no longer an `active` piece.

- [ ] **Step 2: Extend the 0.3.0 CHANGELOG entry**

Under Breaking, add that `sweep` has left `active` and `active` now defaults to `'none'`, with the one-line reason: it never contributed a transform, and its period was silently taken from whatever the longest layered sibling was.

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "document the lighting modes"
```

---

## Self-review

**Spec coverage:** rename + dispersion (T2), velvet (T3), neon (T4), flake/glitter/leather (T9, T11), `LookSpec` (T6, T7), tint targeting (T5), `DEFAULTS` reset (T1), always-injected gated chunk (T9), per-letter seed (T10), aliasing guard (T9), bloom request (T8), tests (throughout, T13), `LOOK_NAMES` ordering (T11). Complete.

**Deferred, per the spec:** the decoration layer — crunchy glitter, leather piping, neon tubing.
