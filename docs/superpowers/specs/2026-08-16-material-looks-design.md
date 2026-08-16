# Material looks 0.3.0 — design

**What:** six looks (three new materials, two new param-only finishes, one rename) and an open
`LookSpec` type so callers can describe a material without importing three.
**For:** whoever implements 0.3.0 of `@blitsklieg/core`.
**Answers:** what ships in the look system, how procedural flakes are shaded, and what is
deliberately held back for the decoration layer.

Everything here lives in `packages/core/src/render/looks.ts` and its tests. No geometry changes.

## What ships

| Look | Reads as | Built from |
|---|---|---|
| `gem` | cut stone, rainbow edge fringing | renames `ruby`, adds `dispersion` |
| `velvet` | fuzzy nap, bright at grazing angles | `sheen`, `sheenColor`, `sheenRoughness` |
| `neon` | glowing tube-lit sign | `emissive`, `emissiveIntensity`, requests bloom |
| `flake` | metallic car paint | flake shader, small cells, narrow cone |
| `glitter` | craft glitter over glue | flake shader, large cells, wide cone, per-cell color |
| `leather` | pebbled hide | flake shader, smooth cell bumps, slight sheen |

`gold`, `chrome` and `oil` are unchanged.

`gold` and `chrome` stay separate looks. They differ in `roughness` (0.16 vs 0.05) and
`clearcoatRoughness` (0.08 vs 0.03), not only in `color` — chrome is a three-times sharper
mirror, and folding them into one tinted look would lose the finish along with the hue.

## The rename

`ruby` becomes `gem`, with no alias. `ruby` shipped in 0.2.0, so this is a breaking change and
0.3.0 is a breaking release.

The rename earns itself by pairing with `dispersion`, which splits transmitted light into
rainbow fringes at the edges. Under 0.2.0 the look was red glass; a stone is what it becomes.
Its red still comes from `attenuationColor`, so `tint` keeps routing there.

## Public API

`look` gains a spec form, mirroring what `enter`/`active`/`exit` already do for motion:

```ts
export type Look = LookName | LookSpec;
```

`LookSpec` is a partial record of plain numbers — every key of `LookParams` plus the new
material keys and an optional `flake` block. No `THREE` type appears in it.

```ts
export interface LookSpec extends Partial<LookParams> {
  flake?: { density: number; size: number; spread: number; color?: number; bump?: boolean };
  tintTarget?: 'color' | 'attenuationColor' | 'emissive' | 'sheenColor';
  bloom?: boolean;
}
```

Three stays a peer dependency and an implementation detail. Accepting a
`MeshPhysicalMaterial` instead would put three's types in every consumer's signatures and make
three's material churn a compatibility problem across the whole `>=0.185 <1.0` range the package
promises to support, as well as foreclosing a WebGPU backend. A caller who genuinely needs raw
three is out of scope for 0.3.0.

`LOOK_NAMES` continues to list names only.

Unknown keys on a caller's spec are ignored, and values are clamped to their valid ranges rather
than rejected. A bad number should dull the material, not throw mid-effect.

## Tint targeting

`HUE_KEY` is currently a record enumerated over the four built-in names. A caller's spec is not
in that record, so the rule becomes explicit and applies to built-ins and specs alike:

1. `tintTarget`, if the spec sets it.
2. `attenuationColor` when `transmission > 0`.
3. `emissive` when `emissive` is non-black.
4. `color` otherwise.

`sheenColor` is reachable only by declaring `tintTarget` explicitly, never by inference. A
velvet's perceived color is its body; the sheen is the highlight riding on top. Tinting the
highlight and leaving the body would make `tint: 0xff0000` on `velvet` produce red-lit
maroon rather than red velvet, which is not what asking for red means.

This reproduces the existing built-in routing, so `gold` still tints `color` and `gem` still
tints attenuation. `flake.color`, when set, tints alongside the target rather than replacing it —
tinting a glitter look should recolor the base without flattening the flakes to one hue.

## Resetting between looks

`DEFAULTS` must gain every new key — `sheen`, `sheenColor`, `sheenRoughness`, `anisotropy`,
`anisotropyRotation`, `dispersion`, `emissive`, `emissiveIntensity`, and the flake uniforms.
`applyLook` spreads a look over `DEFAULTS` rather than over the previous look, so a missing key
is the difference between switching away from `velvet` and dragging its sheen into `gold`
forever. The existing "leaves nothing behind" test extends to cover each new key.

## The flake shader

One `onBeforeCompile` patch, shared by `flake`, `glitter` and `leather`, differing only in
constants.

Cells are hashed from **object-space** position, not world space. Object space glues the flake
field to the letter, which is what real flakes do — world space would make the field swim as the
letter travels through a `slam` or a `float`.

**Per-letter decorrelation is the load-bearing detail.** `Word` shares one material across every
letter and `GlyphCache` shares one geometry per `(char, depth)`, so object-space hashing alone
gives every letter an identical flake field, and the two `L`s in `HELLO` sparkle in lockstep —
which reads as fake immediately. The fix is a per-letter `uSeed` uniform mixed into the hash,
written in `mesh.onBeforeRender` with `material.uniformsNeedUpdate = true` to force the re-upload
across the shared material. This keeps both the shared geometry and the single material. If the
forced re-upload proves unreliable, the fallback is cloning the cached geometry per letter and
carrying the seed as a constant vertex attribute, which costs memory but no re-extrusion.

**The chunk is always injected and gated on `uFlakeDensity > 0`.** A look-switch would otherwise
need a shader recompile, and one program variant for every look is worth more than the branch it
costs the param-only looks.

**Aliasing is the failure mode to design against.** Sub-pixel flakes strobe violently under
minification. The patch fades flake contrast toward the smooth average and widens roughness as
`fwidth` of the cell coordinate approaches one cell, so distant type goes evenly rough instead
of boiling.

`leather` sets `bump: true`, which swaps the per-cell random normal for a smooth rounded cell
profile — pebble grain rather than facets — over the same hash and cell grid.

## Neon and bloom

`neon` is flat without the bloom pass, and `bloom` is currently opt-in per `fire()`. A look may
request bloom via `bloom: true` in its spec; an explicit `bloom` on `FireOptions` still wins in
both directions. Without this the headline look quietly disappoints anyone who did not already
know to pass a second option.

## Lighting modes

The environment rotation that rakes the highlight across the letters is what makes metal read
as metal, and it is currently a passenger on the motion vocabulary. `sweep` is an `active` piece
that contributes no transform at all — it exists only to set `envRotation: true`. That has two
consequences:

- Lighting costs you the `active` slot, or requires knowing to layer into it.
- The rate is `slotDuration(active)`, a `Math.max` over the layers. `sweep` is tuned to 3400ms;
  layered under `float` (5200ms) its period silently becomes 5200ms. The tuning is lost to
  whichever sibling happens to be longest.

Lighting becomes its own named option, orthogonal to all three motion slots and spanning the
whole timeline rather than the active phase:

```ts
lighting?: LightingName   // 'sweep' | 'static', default 'sweep'
```

`sweep` rotates the environment on its own tuned period. `static` holds it still. `LIGHTING_NAMES`
is exported alongside the other name lists, which is all the lab needs to show a picker.

A closed union so more modes can arrive without an API break. A spec form carrying `periodMs`
and environment intensity is the obvious extension and is not scoped here.

**Migration.** `sweep` leaves `ActiveName` — it was never a transform, and the option replaces
it. `active` therefore defaults to `'none'` rather than `'sweep'`, which renders the same picture
under an honest model. `cycle({ envRotation: true })` stays public so a caller-built piece can
still drive the environment.

## Testing

- **Param-only looks** extend the existing `looks.test.ts` snapshot approach. `KEY_SET` grows
  with the new keys, which makes the exhaustiveness check cover them.
- **Shader looks** are asserted without GL: that the `LOOKS` entry declares the expected `flake`
  constants, that the compiled shader source contains the injected chunk, and that the uniforms
  exist with the right values. Vitest has no WebGL context and should not pretend to.
- **`LookSpec`** gets tests for clamping, ignored unknown keys, and each tint-target rule.
- **Visual** verification is a Playwright screenshot per look in the lab, via the existing
  `test:visual` script.
- `LOOK_NAMES` ordering test updates to `['gold', 'chrome', 'oil', 'gem', 'velvet', 'neon',
  'flake', 'glitter', 'leather']`.

## Deferred

**The decoration layer.** Crunchy glitter (real silhouette break), leather piping and neon
tubing are one feature, not three: each is a look contributing a second geometry and material
per letter. They share the same plumbing — a second `GlyphCache` instance, each letter becoming
a `Group` so one pose drives body and decoration together, two materials to fade and dispose.
Crunchy scatters an `InstancedMesh` of chunks across the glyph surface; piping and tubing sweep
a tube along the contours `glyphToShapes()` already returns. Building that plumbing once is the
reason these are held back together rather than bolted onto 0.3.0 one at a time.

One question stays open for that spec: whether neon tubing follows the glyph **outline** or the
stroke **centerline**. Outline is nearly free from the existing contours but reads as a glowing
rim around a fat letter. Centerline is what people picture when they hear "neon" and needs the
glyph's medial axis, which is fragile across fonts and is a project of its own.

Longer-range ideas that are not look scope — precompiled single-effect builds, handwriting
animation — are recorded under Non-goals in the root design doc.
