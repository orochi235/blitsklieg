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

## Usage

```ts
import { createBlitsklieg } from 'blitsklieg';

const bk = createBlitsklieg({ fontUrl: '/fonts/display.ttf' });

await bk.fire('JACKPOT!', { enter: 'slam', active: 'sweep', exit: 'shatter', look: 'gold' });

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
| `sweep` | a highlight rakes across the letters; the word itself holds still |
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
| `ruby` | clear red glass, lit through |

Each list is also exported as a runtime array — `ENTER_NAMES`, `ACTIVE_NAMES`, `EXIT_NAMES`,
`LOOK_NAMES`, `POLICY_NAMES` — for building a picker.

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
of moving the letters, which is what `sweep` does.

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
| `active` | `'sweep'` | what it does while it holds |
| `exit` | `'fade'` | how it leaves |
| `look` | `'gold'` | the material |
| `hold` | `1200` | milliseconds in the active phase, or `'click'` to hold until dismissed |
| `blendMs` | `120` | crossfade window straddling each phase boundary |
| `bloom` | `false` | adds a glow pass, at the cost of three render targets while the effect runs |
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
- `concurrent` — effects play on top of each other. Avoid it with `sweep`: the live effects
  fight over the one shared highlight and it sawtooths between their phases.

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
- `npm run check` — biome, tsc and the unit suite (202 tests).
- `npm run test:visual` — Playwright specs asserting the overlay composites over a live page
  without tinting or blocking it.
- `npm run build:pages -w @blitsklieg/lab && npm run preview:pages -w @blitsklieg/lab` — the
  lab exactly as GitHub Pages serves it, under the `/blitsklieg/` subpath the workflow builds
  for. Plain `npm run build` produces a root-served build instead.
