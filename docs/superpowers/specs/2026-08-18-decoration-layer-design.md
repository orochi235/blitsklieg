# Decoration layer 0.4.0 — design

**What:** a second geometry and material per letter, two generators that build it, and four looks
made from them.
**For:** whoever implements 0.4.0 of `@blitsklieg/core`.
**Answers:** how a look contributes decoration, how `Word` stops sharing one material across the
word, and where each generator's numbers come from.

Work lands in `packages/core/src/render/word.ts`, `looks.ts`, a new `decoration.ts`, and the lab.

## What ships

| Look | Generator | Reads as |
|---|---|---|
| `tubing` | tube | glowing tube piped around a near-invisible volume |
| `piping` | tube | corded seam running the edge of a hide |
| `sequin` | chunks | chunky glitter that breaks the silhouette |
| `pyrite` | chunks | intergrown cubic crystals on a matrix |

`neon`, `glitter` and `leather` are unchanged — the cheap solid variants, one material each and
no second geometry.

`LOOK_NAMES` becomes `['gold', 'chrome', 'oil', 'gem', 'velvet', 'neon', 'flake', 'glitter',
'leather', 'tubing', 'piping', 'sequin', 'pyrite']`.

Additive throughout — every new field is optional and `Word` is not public — so 0.4.0 is a minor.

## The material model

`Word` holds one `MeshPhysicalMaterial` for the whole word. That is what has to go, and it is
most of the work in this spec.

It becomes one material per letter, and a second per letter once a look is decorated. Three
consequences:

- **Opacity stops collapsing.** `apply()` currently writes `material.opacity` from the maximum
  pose opacity across letters, because one material cannot hold thirteen values. A staggered
  enter therefore fades the whole word to whichever letter leads. Per-letter materials remove
  the collapse and the `Math.max` with it.
- **`seedGeometry` is deleted.** Flake decorrelation clones an entire `BufferGeometry` per letter
  solely to carry a seed as a vertex attribute — the comment at `flake.ts:47` explains why, and
  the reason is precisely that a shared material offers no per-draw uniform channel. Per-letter
  materials are that channel. `uFlakeSeed` becomes a uniform, and the clones, the `seeded[]`
  array and its disposal all go. A flake word stops paying a geometry clone per letter.
- **Cost is uniform uploads and N `dispose()` calls**, and it is small. `spikes/per-letter-materials.mjs`
  measures CPU time inside `renderer.render()` on an M2 Max: +0.036 ms/frame at 13 letters and
  +0.066 ms/frame at 50, against a 16.7 ms budget. The relative figure is ~38%, which sounds
  worse than it is — total render CPU is a fifth of a millisecond either way.

Program count stays at 1 in every case measured: three defaults a material's program cache key
to `onBeforeCompile.toString()`, so N materials each capturing their own uniforms in an
identical closure still compile once. The scene was already one object and one draw call per
letter — that is how per-letter motion works — so nothing about splitting the word is new here.

## Plumbing

Each letter becomes a `THREE.Group` holding its body mesh and, when decorated, its decoration.
`apply()` writes the pose to the Group, so one pose drives body and decoration together and no
part of the motion system learns that decoration exists.

A second `GlyphCache` holds decoration, keyed by `char`. `GlyphCache` is already generic over
`{ dispose(): void }`, and its docstring already states that the key discriminates what `build`
varies rather than what it captures — a cache instance per `Word` captures that word's one
decoration spec, so `char` is the whole key.

What it caches is a blueprint, not a mesh, because the two generators need different things
shared:

```ts
type Blueprint =
  | { kind: 'tube'; loops: THREE.BufferGeometry[]; dispose(): void }
  | { kind: 'chunks'; position: Float32Array; normal: Float32Array; dispose(): void };
```

Tube geometry is fully determined by the char, so letters share it directly. Chunk *placement*
is per letter — two Ls in HELLO must not carry identical crystals — so what the char shares is
the surface sample set, and each letter draws from it under its own seed.

## The tube generator

`glyphToShapes()` already returns nested contours with holes attached, which is the input this
wants; tracing the silhouette is both the cheap path and the correct one. Every contour is
piped, counters included — real neon pipes the inside of an `O`.

Each contour's points become a closed `CatmullRomCurve3` with `curveType: 'centripetal'`, and a
`TubeGeometry` is swept along it. Catmull-Rom rounds the corners of an `E`, which is not a
defect here: neon tube cannot bend square, and cord piping does not either.

One geometry per contour, one mesh per contour. Merging a letter's loops into a single buffer
would save draw calls, but `mergeGeometries` lives in `three/examples/jsm`, which this package
does not import from, and hand-rolling an attribute merge is not worth it before per-contour
draw calls are measured to bite.

`at` is an array of depth fractions, so `[1]` is the front face, `[0, 1]` is both, and `[0.5]`
suspends the tube mid-volume. It defaults to `[1]`: a real neon sign is a tube bent in one
plane with a dim backing behind it, and the front face is where that reads.

## The chunks generator

Sample points are drawn from the extruded geometry's triangles, area-weighted so large faces do
not under-receive relative to the bevel band. Position and normal per sample are what the
blueprint stores.

Per letter, a seeded RNG selects `count` samples and orients a chunk at each. `proud` sets how
far it sits outside the surface along the normal — this is what breaks the silhouette, and a
chunk fully embedded in the body is invisible for a look whose whole point is texture. All
chunks in a word share one geometry (a flake quad or a cube) and draw as one `InstancedMesh`
per letter.

Two parameters separate a mineral from debris:

- **`align`** — at 0 each chunk tumbles freely; at 1 every chunk in a letter shares one lattice
  orientation. That alignment is the whole difference between crystal habit and sprinkled cubes.
- **`cluster`** — at 0 samples are drawn evenly; at 1 they are drawn near already-chosen
  samples, giving intergrown clumps with bare matrix between them.

## The types

```ts
type MaterialSpec = Omit<LookSpec, 'decoration' | 'bloom'>;

export type DecorationSpec =
  | {
      kind: 'tube';
      /** Tube radius, in em. */
      radius: number;
      /** Depth fractions to sweep a loop at. Default [1], the front face. */
      at: number[];
      /** Ring segments around the tube. */
      segments: number;
      look: MaterialSpec;
    }
  | {
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
    };

export interface LookSpec extends Partial<LookParams> {
  tintTarget?: TintTarget;
  /** Which material `tint` recolors. Default 'body'. */
  tintTo?: 'body' | 'decoration';
  bloom?: boolean;
  flake?: FlakeSpec;
  /** Base opacity of the body, 0..1. Pose opacity multiplies it. */
  opacity?: number;
  decoration?: DecorationSpec;
}
```

`tube` has no `along` field. Outline is the only value it could take, and the centerline that
would justify the second one is still deferred.

## Opacity

`opacity` is deliberately not a `LookKey`. Every key in `PARAM_KEYS` is written straight onto
the material by `applyLook`, and `apply()` overwrites `material.opacity` every frame from the
pose — a look-declared opacity routed that way would survive exactly until the first tick.

It is a multiplier instead: `material.opacity = pose.opacity * base`. The body's base comes from
`LookSpec.opacity`, the decoration's from its own `look.opacity`, which is what lets a body at
0.08 carry fully opaque tubing. That ratio is the effect, and it is also the honest way to debug
tube geometry in isolation.

## Tint

`tintTo` chooses which material `tint` recolors; within that material, the existing
`tintTargetOf` rule picks the property. `tubing`, `sequin` and `pyrite` route to the decoration —
tinting a near-invisible backing does nothing a viewer can see. `piping` routes to the body,
because answering "make the leather red" with red cord on brown hide is the same failure the
`sheenColor` note in `tintTargetOf` already refuses.

## Where the numbers come from

The presets ship with placeholder values. Radius, segments, `at`, count, size, align, cluster
and proud all get lab sliders with ranges scaled per look, and the values that ship are read off
the lab once each look reads right — the way glitter's grain and density were.

`tubing` sets `bloom: true`, as `neon` does.

## Testing

Vitest has no WebGL context and should not pretend to, so the GL-free assertions are:

- Each `LOOKS` entry declares the expected `decoration` kind and parameters.
- Tube blueprints have one loop per contour per entry in `at`. At the default `[1]`: `O` gives
  two, `i` gives two, `E` gives one. At `[0, 1]`, each doubles.
- Chunk scatter is deterministic — the same letter index yields the same instance matrices, and
  two different indices do not.
- `align: 1` yields one shared orientation across a letter's instances; `align: 0` does not.
- `dispose()` releases both caches, every body material and every decoration material.
- `LookSpec` clamping and the `tintTo` routing rules.
- `LOOK_NAMES` ordering.

Visual verification is a Playwright screenshot per look in the lab, via the existing
`test:visual` script.

## Deferred

**Per-letter color and styled text runs.** Per-letter materials remove the engine obstacle to
letters in different colors, but not the caller-facing question: `fire()` today takes one `tint`
for the whole word, and a run API — spans of text carrying their own tint or look — is a text
API design, not a looks one. It should be specced on its own now that nothing in the renderer
blocks it.

**Merging a letter's tube loops** into one buffer, if per-contour draw calls measure badly.

**A wider bloom chain.** `BloomPath` runs two separable blurs on one half-res target, which is a
tight halo, and a thin glowing tube is the case most likely to want a wide soft one. If `tubing`
reads weak in the lab, the fix is more mip levels in our own chain, not `UnrealBloomPass` — a
stock pass forces frame alpha to 1.0 and turns the overlay opaque, which is why the chain is
hand-rolled in the first place.

**Medial-axis centerline**, unchanged from 0.3.0: a single bent tube forming the stroke is a
different effect from piped edges, and needs stroke data a font outline does not carry.
