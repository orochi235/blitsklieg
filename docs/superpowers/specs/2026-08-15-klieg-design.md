# klieg — design

**What:** a transparent WebGL layer that renders shiny extruded 3D type over an existing web
app, for game-show celebration moments.
**For:** developers of any web app; `wod` (spinning name wheel) is the first consumer.
**Answers:** what klieg's public surface is, how it renders, and what it deliberately won't do.

Named for klieg lights, the carbon-arc lamps that lit early film studios.

## Public API

```ts
const k = createKlieg({ target?: HTMLElement })   // defaults to document.body

k.fire('JACKPOT!', {
  effect: 'slam',        // slam | spin | sweep | burst | flip
  look:   'gold',        // gold | chrome | oil | ruby
  hold:    1200,         // ms held at rest before exit
  bloom:   false,        // opt-in glow; see Render paths
  placement: { kind: 'fullscreen' },
}): Promise<void>        // resolves when the effect finishes

k.supported              // false where WebGL2 is unavailable
k.destroy()
```

`effect` (motion) and `look` (material) are orthogonal: 5 × 4 combinations from two small
tuned sets, rather than 20 hand-built presets.

Placement is a closed union so element-anchoring can arrive without an API break:

```ts
type Placement =
  | { kind: 'fullscreen' }              // v0 — centered, fitted to the window
  | { kind: 'anchor', el: Element }     // v1.2 — not implemented
```

`fullscreen` here means "positioned against the window," not the browser's Fullscreen API.
klieg never calls `requestFullscreen`.

## Packages

```
packages/core    @klieg/core    vanilla three.js, imperative, no framework
packages/react   @klieg/react   thin binding, no logic of its own
apps/lab         Vite demo page
```

npm workspaces, TypeScript, Biome, Vitest — matching `weasel` and `windease`.

Only `three` is a runtime dependency, plus `opentype.js` for fonts.

## Render paths

Two, selected by the `bloom` flag:

**Direct (default).** Scene renders straight to the canvas. Native MSAA, no render target,
no post-processing. Cheaper and sharper.

**Bloom (opt-in).** Scene → render target → luminance threshold → separable blur → composite.
Required for glow, and the reason the composite shader below exists.

The default is direct because glow is a want, not a requirement, and the direct path is
strictly better on both cost and edge quality.

## Decisions

**Fonts are parsed at runtime with opentype.js, not preconverted to typeface.json.**
three's `TextGeometry` requires a build-time conversion that discards kerning, which is
plainly visible on short all-caps words — exactly what klieg renders. opentype.js reads
`.ttf`/`.otf` directly, keeps kerning pairs, and removes the build step. Glyph geometry is
cached by `(font, char, size, bevel)` since letters repeat heavily.

**The environment map is generated at runtime, not shipped as an HDRI.**
A polished metal surface has almost no color of its own; what reads as gold is the
reflection. klieg builds a small cubemap from a dark gradient and a handful of bright bars —
a synthetic photo studio. Two consequences: nothing to download (real HDRIs are 2–50MB), and
the bars are movable. Sliding a bright bar across the letters *is* the `sweep` effect.

**Effects are a closed set.** No extension point until there is a second consumer asking for
one. Reaching three.js internals through an escape hatch would make them klieg's public API
permanently.

## Traps

Each of these fails silently — nothing throws, the output is just wrong.

**`antialias: true` does nothing under post-processing.** It applies to the default
framebuffer only and is ignored once rendering goes through a `WebGLRenderTarget`. The bloom
path needs `samples: 4` on the target. WebGL2 only.

**Bloom destroys canvas transparency.** A stock bloom pass forces alpha to 1.0 across the
frame, turning the overlay into an opaque black rectangle over the host app. klieg's
composite instead derives alpha from glow luminance:

```glsl
outColor = base.rgb + bloom.rgb;
outAlpha = max(base.a, luminance(bloom.rgb) * alphaBoost);
```

Without the second line the glow lives entirely outside the letters' silhouette, where
`base.a` is 0, and is never seen.

**Set `premultipliedAlpha: false` on the renderer.** The default expects RGB pre-scaled by
alpha; a straight-alpha composite against it produces bright halos.

**Color-valued material params are `THREE.Color` objects.** Assigning a hex number over
`material.color` replaces the object and the material stops working. They must go through
`.set()`. This makes `Object.assign(material, params)` unsafe.

**`iridescence: 1.0` does not produce a rainbow.** It sets how much of the thin film shows;
the color range comes from `iridescenceThicknessRange` sweeping a wide nm band. A clearcoat
layered above the film flattens it — `oil` needs `clearcoat: 0`.

## Non-goals

- **Particles** — deferred to v1.1. Until then, consumers layer `canvas-confetti` beneath the
  klieg canvas; confetti will always be behind the letters, never passing in front. Recovering
  that occlusion is the whole reason particles eventually move in-engine.
- **Refracting page content.** Translucent looks refract the environment map only. three's
  transmission samples what is behind the object *in the WebGL scene*, and the DOM is not in
  it. Real refraction would mean rasterizing the page every frame.
- Sound, screen shake, element-anchored placement.

## Lifecycle

One canvas, one WebGL2 context, created lazily on first `fire()` and torn down after an idle
timeout — browsers cap contexts near 16. `pointer-events: none` throughout. Effects queue
serially by default (`queue | replace | concurrent`). `prefers-reduced-motion` renders the
final frame statically. Without WebGL2, `fire()` resolves immediately and `supported` is false.

## Testing

Animation reads time from an **injected clock** rather than `requestAnimationFrame` directly.
Nothing below is testable without this.

- Vitest over the parts that break silently: kerning and layout math, placement math, queue
  state machine, easing curves.
- Playwright screenshots at fixed clock values for visual regression on the composite shader.

## Status

The material and composite work is validated by `spikes/material-and-composite.html`
(120fps at 1280×800 on both render paths). The spike uses typeface.json fonts, so it does not
exercise the opentype.js decision.
