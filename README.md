# blitsklieg

Shiny extruded 3D type, slammed over the web app you already have — the `JACKPOT!` that lands
on screen when something worth celebrating happens. It draws into its own fixed, click-through
canvas above the page, plays one effect, and gives the WebGL context back when it goes idle.
The host page is not touched.

An effect is three motion slots — `enter`, `active`, `exit` — plus a material `look`.

Every effect is playable at **[the lab](https://orochi235.github.io/blitsklieg/)**, which is
deployed from `main`.

## Install

```sh
npm install blitsklieg three
```

`three` is a peer dependency, so the app owns the copy: two copies of three in one bundle break
`instanceof` and double the download. Any version from 0.185 up will do. The package is
ESM-only, and ships as `dist/` with type declarations.

TypeScript users also want `npm install -D @types/three` — three ships no declarations of its
own, and blitsklieg's types reference it.

## Usage

```ts
import { createBlitsklieg } from 'blitsklieg';

const bk = createBlitsklieg({ fontUrl: '/fonts/display.ttf' });

await bk.fire('JACKPOT!', { enter: 'slam', active: 'float', exit: 'shatter', look: 'gold' });

bk.destroy();
```

`fire()` resolves once the effect has left the screen, whether it played out or was cancelled.
It rejects if the font cannot be fetched or parsed — the next `fire()` retries the load rather
than failing forever. `destroy()` cancels everything in flight and releases the GL context once
the running effect has settled.

## Motion

An effect plays `enter`, then loops `active` for `hold` milliseconds, then plays `exit`,
crossfading `blendMs` across each boundary. Enter and exit run at a fixed length per piece
(500–1200ms), so total screen time is about enter + `hold` + exit.

### enter

| name | |
|---|---|
| `slam` | the whole word punches forward out of depth and overshoots as it lands |
| `spin` | letters whirl in around their vertical axis, one after the next, fading up |
| `flip` | letters tip forward over their horizontal axis, one after the next |
| `assemble` | letters converge on the word from scattered positions and tumbling angles |
| `rise` | letters lift into place from below, one after the next, with a small overshoot |
| `none` | the word is simply there |

### active

| name | |
|---|---|
| `float` | a slow bob and yaw, as if the word were hanging |
| `pulse` | a gentle scale breath, a few percent |
| `shimmer` | a small yaw ripple travelling letter to letter |
| `none` | dead still |

### exit

| name | |
|---|---|
| `shatter` | letters fly apart tumbling, fading as they go |
| `drop` | letters fall out of frame under gravity, tipping alternately |
| `recede` | the word shrinks back into depth and fades |
| `fade` | fades out with a slight swell |
| `none` | cuts |

### look

| name | |
|---|---|
| `gold` | warm polished metal |
| `chrome` | near-white mirror metal |
| `oil` | near-black metal under an iridescent thin film |
| `gem` | clear stone, lit through, dispersing to rainbow at the edges |
| `velvet` | deep matte nap, bright at grazing angles |
| `neon` | glowing tube-lit sign; turns bloom on by itself |
| `flake` | dark body shot through with catching flecks |
| `glitter` | fine metallic sparkle, close to car paint |
| `leather` | upholstery panels, creased at the seams |
| `tubing` | glowing tube piped around a near-invisible volume; turns bloom on by itself |
| `piping` | corded seam running the edge of a hide |
| `sequin` | chunky glitter that breaks the silhouette |
| `pyrite` | intergrown cubic crystals on a dull matrix |

### lighting

The environment is what makes metal read as metal, and it is independent of all three motion
slots.

| name | |
|---|---|
| `sweep` | rakes the highlight across the letters, on its own period |
| `static` | holds the environment still |

Each list is also exported as a runtime array — `ENTER_NAMES`, `ACTIVE_NAMES`, `EXIT_NAMES`,
`LOOK_NAMES`, `LIGHTING_NAMES`, `POLICY_NAMES` — for building a picker.

`tint` recolors any look to your own color, keeping everything else about the material:

```js
await bk.fire('YOU WIN', { look: 'gold', tint: 0xff2d6f });   // pink metal
await bk.fire('YOU WIN', { look: 'gem', tint: 0x2dff8f });    // green stone
```

It goes to whichever property actually carries that look's hue. For the metals that is the base
color; `gem` is clear stone whose red comes from what light picks up passing *through* it, and
`neon` is a near-black body whose color is entirely its glow, so tinting either one's base color
would change nothing you could see.

`look` also takes a plain object instead of a name, for a material of your own:

```js
await bk.fire('YOU WIN', { look: { metalness: 1, roughness: 0.3, color: 0x00e5ff } });
```

Every field is a number, so nothing about three appears in your types. Out-of-range values clamp
rather than throw. `tintTarget` overrides which channel `tint` writes to when the default
routing guesses wrong.

## Stages

An effect can exit part of its word and lay the survivors out again as a word of their own — a
poem whose first letters are their own color, then everything else leaves and those letters
gather into a word. `then` is the list of stages, played after the enter:

```ts
await bk.fire(poem, {
  hold: 'click',
  then: [
    { keep: (l) => l.column === 0, exit: 'fade', as: 'stack', hold: 'click' },
    { as: 'line', hold: 'click' },
  ],
});
```

Each stage:

| field | default | |
|---|---|---|
| `keep` | keeps all | the letters that continue; the rest play this stage's `exit` |
| `exit` | `'fade'` | how the letters that do not continue leave |
| `as` | `'line'` | the survivors' new layout — one line, or `'stack'` for one letter per line |
| `active` | `'none'` | what the new word does while it holds |
| `hold` | `1200` | milliseconds, or `'click'` to wait for the viewer |
| `tween` | none | timing for the move into the new layout |

Survivors keep their own material, so a letter's color travels with it. Everything a motion
piece reads off the letter — `index`, `count`, `line`, `column`, `x`, `y` — describes the new
word, not the old one.

`tint` takes a rule as well as a color, which is how the letters that survive get their own one:

```ts
tint: (l) => (l.column === 0 ? 0x2df0ff : undefined)
```

Returning `undefined` leaves that letter the look's own color.

`tween` is `{ duration, ease, delayBy }`. `delayBy` holds one channel back: `position` by a
fraction of the move, `scale` — the viewport refit — by a fraction of the whole stage, so it can
wait out an exit that outlasts the move. `delayBy: { scale: 0.45 }` lands the word before it
grows to fill the screen.

Under `prefers-reduced-motion: reduce` the stages do not play — that path holds a pose and never
travels, so there is nothing to regroup.

## Writing your own motion

Every slot also takes a piece you built, or several layered together:

```js
import { spring, transition } from 'blitsklieg';

const swoop = transition(800, {
  from: { position: [0, -6, 0], opacity: 0 },
  ease: spring({ stiffness: 180, damping: 11 }),
  stagger: { each: 0.06, from: 'center' },
});

await bk.fire('YOU WIN', { enter: swoop, active: ['float', 'shimmer'] });
```

Names and pieces mix freely in a layered slot — `active: ['float', myShimmer]`.

A `MotionPiece` is `{ duration, offset(t, letter) }` where `offset` returns a *relative* pose —
position and rotation add onto rest, scale and opacity multiply. It must be a **pure function**:
the compositor samples up to three pieces at three different points in the same frame to
crossfade them, so a piece that remembers anything between calls will tear.

`transition(duration, spec)` builds an arrival or a departure. `from` starts displaced and
relaxes to rest; `to` starts at rest and departs. Either accepts a function of the letter, which
is how per-letter scatter stays deterministic and screenshots stay stable. `keyframes` takes N
stops instead. `ease` sets the curve, `easeBy` overrides it for one channel, and `stagger`
controls per-letter delay: `spread` fixes the total ramp, `each` fixes per-letter cadence, and
`from` picks the order — `start`, `end`, `center`, `edges` or `random`, with `grid: true`
measuring it radially over a multiline block.

`cycle(duration, spec)` builds a looping idle from a per-channel `amplitude`, an optional
`harmonic`, and a `phase` function. `envRotation: true` rakes the environment highlight instead
of moving the letters, and overrides the `lighting` option for as long as that piece is active.

`spring({ stiffness, damping, mass })` returns a curve, not an animation — it is the closed-form
solution, so it stays a pure `(t) => number` and can go anywhere an easing goes.

`Easing` is exactly `(t: number) => number`, which is also `d3-ease`'s signature, so any curve
library drops straight in:

```js
import { easeElasticOut } from 'd3-ease';
const bounce = transition(700, { from: { scale: 0 }, ease: easeElasticOut });
```

## Options

`createBlitsklieg(options)`:

| field | default | |
|---|---|---|
| `fontUrl` | required | a TTF or OTF opentype.js can parse, fetched once per instance on the first fire |
| `target` | `document.body` | element the overlay canvas is appended to |
| `clock` | `requestAnimationFrame` | time source; pass the exported `ManualClock` to drive effects by hand in tests |
| `policy` | `'queue'` | what a fire does when one is already running (below) |
| `idleTimeoutMs` | `8000` | idle milliseconds before the GL context is torn down; the next fire brings it back |

`fire(text, options)`:

| field | default | |
|---|---|---|
| `enter` | `'slam'` | how it arrives — a name, your own piece, or an array of them |
| `active` | `'none'` | what it does while it holds |
| `exit` | `'fade'` | how it leaves |
| `look` | `'gold'` | the material — a name, or a spec of your own |
| `lighting` | `'sweep'` | how the environment lights it |
| `tint` | none | recolors the look, as `0xff2d6f`, or a rule consulted per letter |
| `hold` | `1200` | milliseconds in the active phase, or `'click'` to hold until dismissed |
| `then` | none | stages played after the enter, each regrouping what survives it |
| `blendMs` | `120` | crossfade window straddling each phase boundary |
| `bloom` | look's choice | adds a glow pass, at the cost of three render targets while the effect runs |
| `wrap` | `false` | break long text into the arrangement that renders largest |
| `modal` | `false` | with `hold: 'click'`, let the overlay swallow the dismissing click |
| `placement` | `{ kind: 'fullscreen' }` | accepted but unread in v0; the overlay is always fullscreen |

## Multiple lines

A `\n` in the text always breaks a line, and each line is centered on its own:

```js
await bk.fire('BIG\nMONEY');
```

`wrap: true` additionally breaks long text for you. It picks whichever arrangement renders
*largest* rather than fitting to some column count, so it wraps only when wrapping makes the
type bigger — short text is already at the scale cap and stays on one line. Words are never
split, and the viewport budget means a block realistically runs to two or three lines before
height binds; blitsklieg renders banners, not paragraphs.

## Holding until dismissed

`hold: 'click'` keeps the effect on screen until the viewer presses a pointer or Escape, then
plays the exit normally. The promise stays pending until then, and under the default `queue`
policy a held effect blocks every later `fire()` — use `replace` if a later effect should cancel
it instead.

The dismissing click passes through to your page by default, so it both dismisses the effect and
presses whatever was underneath. `modal: true` makes the overlay swallow it instead; that is the
one state in which blitsklieg is not click-through, which is why Escape is always bound.

## Queue policies

- `queue` — effects play one at a time, in the order fired.
- `replace` — a new fire aborts the running effect and drops anything still waiting.
- `concurrent` — effects play on top of each other. Avoid it with `lighting: 'sweep'`: the live
  effects fight over the one shared highlight and it sawtooths between their phases.

## Browser support

WebGL2 is required. `createBlitsklieg` never throws for want of it, or for want of a DOM:
construction succeeds during server rendering and in a browser without WebGL2, and reports
`supported: false`. On an unsupported instance `fire()` resolves immediately, having loaded no
font and rendered nothing, so calls need no guard — read the flag only to do something else
instead:

```ts
if (!bk.supported) confetti();
```

Under `prefers-reduced-motion: reduce` the word holds the pose its enter settles into for
`hold` and then leaves, with no travel.

## Development

- `npm run dev -w @blitsklieg/lab` — the lab page: every motion, look and policy behind
  pickers, plus canned sequences.
- `npm run check` — biome, tsc and the unit suite (547 tests).
- `npm run test:visual` — Playwright specs asserting the overlay composites over a live page
  without tinting or blocking it.
- `npm run build:pages -w @blitsklieg/lab && npm run preview:pages -w @blitsklieg/lab` — the
  lab exactly as GitHub Pages serves it, under the `/blitsklieg/` subpath the workflow builds
  for. Plain `npm run build` produces a root-served build instead.
