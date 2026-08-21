# klieg — motion authoring vocabulary

**What:** two constructors that build motion pieces declaratively, a stagger vocabulary, springs
as easing, and the public surface that lets callers supply their own pieces.
**For:** anyone working on klieg core. Assumes the v0 design doc.
**Answers:** how a piece is authored, what the extension point exposes, and why the existing
thirteen are rewritten on top of it.

## The primitive

A two-stop transition is `scaleOffset(from, 1 - ease(t))`.

`scaleOffset` already exists in `pose.ts` to fade a phase's contribution toward identity during a
blend, and fading toward identity is exactly what an entrance does: start displaced, end at rest.
It sends additive channels to 0 and multiplicative ones to 1, which is why `{ scale: 0.55 }` grows
to `1` rather than collapsing to `0`.

Checked against `slam`: `1 + (0.55 - 1) · w` is `0.55` at `w = 1` and `1` at `w = 0`, matching the
hand-written `0.55 + 0.45 · e` term for term. Everything below is vocabulary over a primitive the
compositor already depends on.

## transition()

Covers `enter` and `exit`.

```ts
transition(duration: number, spec: TransitionSpec): MotionPiece

interface TransitionSpec {
  /** Enter: where letters begin, relaxing to rest. */
  from?: PoseOffset | ((letter: LetterInfo) => PoseOffset);
  /** Exit: where letters end up, departing from rest. */
  to?: PoseOffset | ((letter: LetterInfo) => PoseOffset);
  /** N stops, each an offset from rest. from/to are sugar for the two-stop cases. */
  keyframes?: Keyframe[];
  ease?: Easing;                          // default easeOutCubic
  easeBy?: Partial<Record<keyof PoseOffset, Easing>>;
  stagger?: StaggerSpec;
}

type Keyframe = PoseOffset & { at: number; ease?: Easing };
```

Exactly one of `from`, `to`, `keyframes`.

Stops interpolate channel-wise, absent channels reading as identity — 0 for position and
rotation, 1 for scale and opacity. The two-stop case reduces to the primitive exactly:
lerping `scale` from `s` to `1` across `u` gives `s + (1 - s)·u`, which is `1 + (s - 1)·(1 - u)`.
So `from`/`to` sugar and the general form are the same arithmetic, and parity does not depend on
which you write.

Curves in `easeBy` override `ease` per channel, and a `Keyframe.ease` overrides both for the
segment beginning at that stop. All of them receive the staggered parameter, not raw `t`.

`easeBy` is not a convenience. Three of five entrances and two of four exits already ease one
channel differently from the rest: `rise` travels on `backOut` while its opacity ramps on
`min(1, s · 3)`, and `flip` steps opacity at a threshold rather than ramping it. Without
per-channel curves the existing repertoire can only be approximated.

The function form of `from`/`to` carries per-letter variation — `assemble` and `shatter` scatter by
golden angle off `letter.index`, `drop` alternates spin direction on index parity. A function of
`LetterInfo` rather than an RNG is what holds screenshots stable.

## Stagger

```ts
interface StaggerSpec {
  /** Fraction of the pass consumed by the ramp-in. Mutually exclusive with `each`. */
  spread?: number;
  /** Fraction of the pass between consecutive letters; spread = each × count. */
  each?: number;
  from?: 'start' | 'end' | 'center' | 'edges' | 'random';   // default 'start'
  /** Order by 2D position in the block rather than reading order. */
  grid?: boolean;
}
```

The existing `stagger(t, letter, spread)` keeps its shape. What changes is that the per-letter
start is derived from an **order key** `k ∈ [0, 1]` instead of `index / count` directly:
`start = k · spread`, then the same clamped ramp over the remaining span.

| `from` | order key |
| --- | --- |
| `start` | `index / count` — today's behavior, exactly |
| `end` | reversed |
| `center` | normalized distance from the middle, so the middle goes first |
| `edges` | its complement, so the outermost go first |
| `random` | a deterministic hash of `index`, stable across runs |

`random` must be a hash, never an RNG. Screenshot tests compare frames across runs, and a seeded
generator whose call order depends on letter count fails that quietly.

`spread` and `each` differ in what stays constant. `spread` fixes the total ramp, so a longer word
packs its letters tighter; `each` fixes per-letter cadence, so a longer word ramps for longer. The
repertoire is written in `spread` because that is what reproduces it.

With `grid`, the key is measured over `(column, line)` in the laid-out block rather than reading
order, which makes `center` a radial ripple out of the middle of a multiline block instead of a
sweep through its middle letter. This requires `line`, `column`, `lineCount` and `columnCount` on
`LetterInfo`; see the multiline design doc. Default is off, and with a single line the two agree.

## Springs

```ts
spring(params?: { stiffness?: number; damping?: number; mass?: number }): Easing
```

An underdamped harmonic oscillator has a closed-form step response, so this returns an ordinary
`Easing` — pure, resamplable at arbitrary `t`, no integrator and no state. It goes anywhere a
curve goes, including `easeBy` and `Keyframe.ease`. Overshoot becomes a physical dial rather than
`backOut`'s `1.70158`.

The trap is the tail. A spring has not fully settled at `t = 1`, and the residual leaves every
letter fractionally short of rest — a permanent offset, since `enter` hands over to `active` at
exactly that point. `spring()` therefore corrects to `f(t) = raw(t) + t · (1 - raw(1))`, pinning
`f(0) = 0` and `f(1) = 1`. Without it the word settles visibly wrong and nothing in the type
system notices.

Stateful springs — react-spring, Framer Motion, Popmotion — stay out. Their value at `t` depends
on integration history, and `Timeline.poseAt` samples three pieces at three different local times
in a single frame.

## cycle()

Covers `active`.

```ts
cycle(duration: number, spec: CycleSpec): MotionPiece

interface CycleSpec {
  amplitude?: PoseOffset;                 // peak deviation per channel
  harmonic?: PoseOffset;                  // cycles per pass, per channel; default 1
  phase?: (letter: LetterInfo) => number; // radians, added per letter
  envRotation?: boolean;                  // drives the environment instead of the transform
}
```

Each channel is `amplitude · sin(t · 2π · harmonic + phase)`, multiplicative channels centered on
1 rather than 0.

Per-component harmonics look fussy until you try to write `float` without them: it runs position
on the fundamental and rotation-x at double rate, and the beat between the two is the character of
the motion.

## Compositor

Two changes. The weight ramps and the additive model are the good part and stay as they are,
including the `total > 1` guard — reformulating the weights to partition unity by construction
would quietly alter every existing blend to fix a case a commented guard already handles.

**Slots hold layers.** `TimelineOptions.enter`, `.active` and `.exit` widen to
`MotionPiece | MotionPiece[]`, and a slot's offsets are summed before its weight is applied.
`accumulate` already takes a list, so the weight math is untouched. A layered slot's duration is
the longest of its pieces, and its `envRotation` is true if any piece sets it. This exists because
`float` and `shimmer` cannot currently run together, and layering is the first thing anyone tries
once pieces are constructible.

**`poseAt` writes into a caller-owned `Pose`.** It runs once per letter per frame and currently
allocates a `parts` array, an `offsets` array, an object and up to two arrays inside `scaleOffset`,
then two arrays and an object in `accumulate` — roughly ten allocations per letter per frame,
which a thirty-letter block at 60fps turns into ~18,000 objects a second of garbage. Multiline
multiplies it by line count.

```ts
poseAt(elapsed: number, letter: LetterInfo, out: Pose): Pose
```

`Word` keeps one scratch `Pose` and one scratch offset per slot. An explicit out-parameter rather
than a quietly reused return value: an aliased return is a trap for the next caller who retains
what they were handed, and the signature is the only place that warning survives.

This is not a profiled fix — no frame drop has been measured. It is cheap, behavior-preserving,
and the hot loop of an animation library is the wrong place to leave a steady garbage stream.

## Extension point

`index.ts` exports `Easing`, `Vec3`, `PoseOffset`, `LetterInfo`, `MotionPiece`, `Keyframe`,
`StaggerSpec`, `transition`, `cycle`, `spring`, and the built-in curves. `FireOptions.enter`,
`.active` and `.exit` widen from a name to `Name | MotionPiece | MotionPiece[]`, mixed freely —
`active: ['sweep', myShimmer]` resolves names and passes pieces through.

`MotionPiece` takes a number and returns a plain object. Nothing in the contract mentions three.js,
so opening it does not make renderer internals permanent public API — which was the real risk
behind keeping the set closed, rather than the count of consumers.

Custom easing follows from the same export. `Easing` is `(t: number) => number`, which is also
`d3-ease`'s signature, so a caller wanting `easeElasticOut` imports `d3-ease` and passes it. Core
keeps its two runtime dependencies and callers get thirty more curves.

`ENV_DRIVEN` — a hardcoded set naming `sweep` — is replaced by reading `envRotation` off the
resolved piece. A custom active piece can rake the highlight; a caller naming `sweep` sees no
change.

## The existing repertoire

All thirteen are rewritten in this vocabulary. It is the only honest test of whether the
vocabulary is expressive enough, and it removes the two forms of the same motion that would
otherwise drift apart.

| piece | shape |
| --- | --- |
| `slam` | `from` z + scale, `backOut` |
| `spin` | `from` rotation-y + opacity, `spread: 0.55` |
| `flip` | `from` rotation-x, stepped opacity via `easeBy`, `spread: 0.6` |
| `assemble` | `from` as golden-angle scatter, opacity on its own doubled curve |
| `rise` | `from` y + opacity, `backOut`, `easeBy.opacity`, `spread: 0.35` |
| `shatter` | `to` as golden-angle scatter, `easeBy.opacity: easeInCubic` |
| `drop` | `to` y + parity spin on `t²`, `easeBy.opacity: easeInCubic` |
| `recede` | `to` z + scale + opacity, `easeInCubic` |
| `fade` | `to` opacity + scale, `linear` |
| `sweep` | `cycle` with `envRotation`, no transform |
| `float` | `cycle`, position fundamental, rotation-x doubled |
| `pulse` | `cycle`, scale only |
| `shimmer` | `cycle`, rotation-y with per-letter phase |

Every one is exact, on `spread` and `from: 'start'`. The rewrite is behavior-preserving to the
number, not a re-tune. None of the thirteen needs a third keyframe stop; `keyframes` is capability
for what comes next.

## Testing

A parity suite is the point. For each of the thirteen, sample the old implementation and the new
one across `t` at several letter indices and assert the offsets match. Written first, against the
current pieces kept temporarily beside the new ones, it turns an invisible re-tune into a failing
test.

Beyond parity:

- `transition` weight direction — `from` relaxes toward identity, `to` departs from it.
- Two-stop `keyframes` agreeing with the `from`/`to` sugar to the number.
- `easeBy` overriding one channel while the rest keep `ease`.
- `scaleOffset` semantics through the constructor: `{ scale: 0.5 }` reaches `1`, never `0`.
- Each `from` mode's order key, and `random` returning identical values across runs.
- `spread` and `each` agreeing when `each = spread / count`.
- `spring()` hitting exactly 0 and 1 at the endpoints, overshooting in between.
- `cycle` harmonics and per-letter phase.
- A caller-supplied `MotionPiece` passed to `fire()`, including one with `envRotation`.
- A layered slot summing its pieces, taking the longest duration, and reporting `envRotation` if
  any member sets it.
- `poseAt` writing into the `out` pose and leaving no other object reachable — same values as the
  allocating version across the parity samples.

## Non-goals

Serializing pieces to JSON, and a timeline editor. Both want a data format rather than functions,
and nothing here forecloses adding one later.
