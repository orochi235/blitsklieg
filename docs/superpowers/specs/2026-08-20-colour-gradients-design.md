# Colour gradients

**For:** whoever implements this next. Assumes the tube pipeline in
`packages/core/src/render/tube/`, and that a run's colour now reaches the shader —
`tint.ts` patches a look's own channel from the per-vertex `runColor` attribute.

**Answers:** where a colour sweep is specified, where each kind of sweep is evaluated, and what it
does to the colours `assign` already deals.

## The decision

One new optional field. Absent, every run is flat and the output is today's, byte for byte.

```ts
/** A colour sweep across the sign. */
gradient?: {
  domain:
    | { of: 'run' }                            // 0..1 along each run, restarting
    | { of: 'letter' }                         // 0..1 across each glyph's lit length
    | { of: 'runIndex' }                       // one value per lit run, in run order
    | { of: 'surface' }                        // one value per layer
    | { of: 'axis'; angle?: number }           // position across the word; 0 = +x
    | { of: 'radial'; at?: [number, number] }; // distance from a point in word bounds
  /** Colours the sweep runs through. Two is a fade; more is a ramp. */
  stops: number[];
  /** `replace` paints ramp(t); `modulate` multiplies the run's own colour by it. */
  mode: 'replace' | 'modulate';
};
```

`modulate` is why the ramp carries its own `stops` rather than reinterpreting `colors`: under
`modulate` the deck `assign` deals is the thing being swept, so it has to keep working.

## Three tiers

A domain is evaluated wherever its context already lives. This is the whole of the design.

| tier | domains | evaluated in | cost |
|---|---|---|---|
| per run | `runIndex`, `surface` | `assign` | none — resolves into `run.color` |
| per vertex | `run`, `letter` | `buildTubeGeometry` | one float attribute, in the loop that already writes `uv` |
| positional | `axis`, `radial` | vertex shader | one bounds uniform per letter |

The split is forced, not stylistic. `buildTubeBlueprint` runs **per glyph, at 1 em**, and the
letter's place in the word is a group `position` applied afterward (`word.ts:299`) — so a glyph does
not know where it sits. Baking a positional sweep into the colour attribute would feed layout back
into geometry, and the fit is re-settled on every layout pass, so a resize would rebuild every
letter's attribute. `modelMatrix` already carries the placement, which makes the shader the cheap
place rather than the expensive one.

## What `t` is

- **`run`** — `i / (ringCount - 1)`, the fraction `buildTubeGeometry` already writes to `uv.x`.
- **`letter`** — cumulative lit length within the glyph, over the glyph's lit total.
- **`runIndex`** — the lit run's ordinal over the lit count. Constant within a run.
- **`surface`** — the layer's ordinal in `surfaces`. Constant within a run.
- **`axis`** — the point projected onto the direction, over the bounds' extent along it.
- **`radial`** — distance from `at`, over the distance from `at` to the **farthest bounds corner**.
  Not half the diagonal: an off-centre origin then leaves most of the word in the ramp's tail, which
  is why `corner glow` on the preset sheet barely reads.

Only lit runs are swept. A dark run draws with `dark`, which carries no run-colour contract.
Where a `surface` domain and `surfaceColors` are both set, `surfaceColors` wins — it names colours
per layer directly, and the domain is the coarser way of asking for the same thing.

Clamp `t` to 0..1. `ringsOf` domes each run end with `CAP_RINGS` rings offset along the tangent
*past* the endpoint, so under a positional domain the caps sample outside the word bounds.

## The ramp

Stops interpolate in **linear space**, matching the note already in `tint.ts` about `setHex`
converting from sRGB. An sRGB lerp pink→cyan passes through grey.

Under `modulate` the stops are multipliers, so a ramp's floor is written into its stops rather than
into a field of its own. **A stop below roughly `#555555` reads as a dead tube, not a shaded one**
on an emissive look — visible on `wash`, `spotlight` and `chase`.

## Where it lands

- **`gradient.ts`** (new, beside `tint.ts`) — the domain→`t` contract and the ramp. The pure part,
  and the only part with unit tests.
- **`assign.ts`** — the per-run tiers, in both modes, writing `run.color` as it already does.
- **`sweep.ts`** — a `gradientT` float attribute, in the loop that writes `uv` and `runColor`.
- **`tint.ts`** — one ramp lookup, with the source of `t` chosen by a compile-time define so there
  is no runtime branch. `customProgramCacheKey` currently distinguishes only the channel and must
  take the domain too.
- **`word.ts`** — the bounds uniform, set per letter beside `seedFlake`.
- **The lab rail** — domain and mode controls, so the presets are reachable without a rebuild.

## Acceptance

- All 24 Playwright baselines pass unchanged with `gradient` absent. This is the same claim the
  run-colour work made, and the same way of making it.
- Domain→`t` is unit tested without WebGL for the per-run and per-vertex tiers.
- Each preset below renders in the lab as it does in the spike.

## Presets

`spikes/gradient-presets.mjs` draws all of them as an SVG page; tune stops there before touching a
look. Runs are drawn as polylines, since the question is only which vertex gets which colour.

| preset | domain | mode | note |
|---|---|---|---|
| `electrode` | run | replace | dim → hot → dim. What a real tube does, and the reason the run domain earns its place |
| `sweep` | axis 0° | replace | the plain left-to-right fade |
| `sunset` | axis 0° | replace | three stops; the ramp, not the fade |
| `rise` | axis 90° | replace | vertical, for tall words |
| `wash` | axis 0° | modulate | the deck kept, brightness swept across it |
| `dawn` | axis 0° | modulate | the deck kept, tint swept |
| `halo` | radial | replace | white core out through pink to violet; the strongest of the set |
| `spotlight` | radial | modulate | the deck kept, bright in the middle |
| `letterwise` | letter | replace | the sweep restarts each glyph |
| `stepped` | runIndex | replace | four stops, no variation inside a run |
| `chase` | runIndex | modulate | the deck ramped by run order |
| `layered` | surface | replace | front against back |

## Settled

- **The run domain is worth building, and `per-tube` was a bad advertisement for it.** A full hue
  sweep per tube reads as confetti; a symmetric ramp reads as shading. `electrode` is the case.
- **`runIndex` and `surface` are not gradient domains in any mechanical sense.** They produce one
  value per run and never touch geometry or the shader.
- **`layered` wants a shipped look with `back` enabled.** Nothing currently sets more than
  `surfaces: ['front']`, so the domain is inert on `tubing` and `piping` as they stand. Enabling it
  is a look change and out of scope here.
