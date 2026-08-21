# Tube geometry — one diameter, and a pigtail that advances

**What:** the geometric model that replaces the tube's per-run radius clamp, and the rule a loop has
to satisfy. **For:** whoever implements it. **Answers:** what the rules become and what still needs
the owner's call.

The `tubing` look draws neon-style glass tube along paths traced from each glyph's outline. The
pipeline is `packages/core/src/render/tube/`; the workbench that measures it is
`packages/core/dev/tube-lab` (see `2026-08-19-tube-lab-design.md`). Two of its rules produce
geometry no bender would make. Every number below is from that lab's `skeleton` panel — run
centerlines plus per-run diagnostics — or from `spikes/clamp-vs-blur.mjs`, on the shipped specs at
seed 0.

## The tube is not one diameter

`sweepRadius` (`sweep.ts`) measures a run's tightest curvature radius and sweeps at `CLEARANCE = 0.8`
of it. One sharp corner therefore sets the thickness of the whole run it sits in:

Measured across all 26 letters by `spikes/alphabet-sweep.mjs`:

| | worst run | runs clamped |
| --- | --- | --- |
| `tubing` W | 18% of requested | 2 of 7 |
| `tubing` M | 19% | 2 of 8 |
| `tubing` N | 31% | 2 of 7 |
| `tubing` E | 96% | 1 of 6 |
| `piping` M | 26% | 1 of 1 |
| `piping` N | 45% | 1 of 1 |
| `piping` E | 68% | 1 of 1 |

**`M` and `W` are the worst case, not `N`.** `N` is only the fifth-tightest glyph; the standing
`NSRE` test string misses the extremes entirely and every earlier number in this document was taken
from it. `M` asks the tube to bend at 0.32 of its own radius, `W` at 0.38, against `N`'s 0.44.

`piping` fares worst because it asks for one run per contour, so a single corner starves an entire
letter: **every one of the 26 clamps**, 26 to 69% of the requested 0.03, and only `O` escapes. The
standing complaint that piping's cord "draws nothing front-on at radius 0.03" is this clamp, not the
radius.

The clamp exists for a real reason. Sweeping a circle of radius `r` along a path whose local
curvature radius is smaller than `r` drives the inner wall through itself and the surface turns
inside out. But that is a meshing constraint, and shrinking `r` applies it to the wrong variable.
Glass is one diameter. A bender who meets a corner tighter than the tube can take rounds the corner
at their minimum bend radius, or cuts and splices — never draws thinner glass.

## The model: constrain the path, not the radius

**Minimum bend radius.** Define `ρmin = bend · r`, where `bend` is a new per-look spec field: how
tightly this material bends relative to its own thickness. It is a material property, so it is a
multiple of `radius` rather than an absolute em value — that way changing `radius` cannot silently
break corner handling. `CLEARANCE` survives as its floor: `bend` may not go below `1 / 0.8 = 1.25`,
because the mesh is invalid there whatever the material claims.

**Corners are found by bend radius, not by angle.** On an arc-length-resampled path with spacing
`s`, a vertex whose direction changes by `θ` has bend radius `ρ = s / (2 sin(θ/2))`. Today's
`DEFAULT_CORNER = π/6` is that test in disguise: at the shipped `spacing 0.02` and `radius 0.022`
it fires at exactly `ρ < 1.76 r`. Stating it as a bend radius costs nothing and makes it respond to
both knobs instead of neither.

That yields two classes of corner, both detected in one pass over the original path:

- **Hard** — `ρ < ρmin`. The glass physically cannot go round it. Across the alphabet at `bend = 2`:
  228 of them on `tubing` and 244 on `piping`, over every letter of both. **Filleting is the common
  path, not the exception**, and the model has to be robust in the ordinary case rather than merely
  correct in the rare one.
- **Stylistic** — `ρmin ≤ ρ < ρstyle`. The glass could carry through; whether it does is a look
  decision, and `corners: { break, connect, loop }` keeps drawing it exactly as today. `ρstyle` is a
  second multiple of `r`; 1.76 reproduces today's `DEFAULT_CORNER` at the shipped spacing, which is
  the value to start tuning from.

**Detect at `max(ρmin, ρstyle)`, not at `ρstyle`.** The two thresholds are not ordered: `ρstyle` is
`1.76 r` and `ρmin` is `bend · r`, so at the settled `bend = 2` the stylistic band is empty and — the
part that bites — a corner between `ρstyle` and `ρmin` is hard yet falls above the detection
threshold, so no stage ever sees it and the one-diameter invariant fails with no local cause.
Measured, that strands 13 hard corners on `tubing` at `bend = 2` and 174 at `bend = 3`.

A genuinely stylistic class therefore requires `bend < 1.76`, not a change to `ρstyle`. At the
shipped value every detected corner is hard, and filleting is the ordinary path: 228 hard corners on
`tubing` and 244 on `piping`, across all 26 letters of both.

Detect once, before any geometry changes. A fillet built at `ρmin` has per-vertex turns of
`s / ρmin`, which at the shipped numbers is 26° — within a few degrees of `DEFAULT_CORNER`. Any
scheme that re-detects corners after filleting will find the fillets.

**The three strategies keep their names and gain real geometry.**

- **`connect`** stops meaning "merge the arcs and hope". It now means *fillet*: replace the corner
  vertex with a circular arc of radius `ρmin` tangent to both legs, resampled at `spacing` like the
  rest of the path. This is the bender's actual move.
- **`break`** is unchanged: cut, two run ends.
- **`loop`** is the pigtail — a full turn of tube carrying the path past the corner — which absorbs
  any turn given enough length. It stays a stylistic draw rather than an automatic fallback,
  because a letter full of flourishes is not a letter.

**A fillet cuts the corner back, and that has to fit.** The setback along each leg is
`T = ρmin · tan(θ/2)`. Across the alphabet the largest is 0.112 em at `bend = 2` (`M`'s apex) and
0.167 em at `bend = 3`. Two tests decide whether a fillet is admissible:

1. **Room.** Each adjacent leg must be at least `T` long, and where both ends of a leg fillet, the
   two setbacks must fit in it together.
2. **Clearance.** The fillet must not push the tube into another part of the tube. A convex fillet
   moves the path toward the letter's body and can meet the far wall of a thin stem; a concave one
   moves it outward into a counter. Both are answered by the same query: hash all path points into
   a uniform grid, and reject the fillet if any of its samples comes within `2r` of a path point
   more than a few `ρmin` away in arc length.

   The test must be **relative**, not absolute. Runs already pass within `2r` of each other in tight
   counters at the shipped radius; an absolute test would veto fillets precisely where they change
   nothing. Reject only a fillet that *reduces* the clearance the unfilleted path already had.

A hard corner that fails either test falls back to `break`. `CONNECT_LIMIT` — the fixed angle past
which connect is discouraged today — is then redundant: whether a corner can be connected is
whether its fillet fits, which is a measurement rather than a guess.

**`sweepRun` sweeps at the requested radius, always.** Diameter becomes an invariant of the
blueprint rather than an outcome of it. The backstop for a run that still violates `ρmin` is a
**break at the offending vertex**, not a shrink: cutting preserves the invariant, and run count is
already documented as a request rather than a guarantee.

That invariant has an ordering constraint the implementation must resolve: **no stage after corner
handling may reduce a run's bend radius below `ρmin`.** One stage does. `wanderFaceRuns` mutates run
points in place after `cutIntoRuns` and after `assign`, so a backstop that runs late has to re-cut
runs whose indices and colours are already assigned. Either wander moves ahead of cutting — it
currently seeds off the run index, which would need another stable source — or its curvature
contribution is bounded up front. Pick one in the plan rather than discovering it.

### What each constant becomes

| Today | Becomes |
| --- | --- |
| `CLEARANCE = 0.8` (`sweep.ts`) multiplies the swept radius down | the floor on `bend`: `ρmin ≥ r / 0.8` |
| `DEFAULT_CORNER = π/6` (`runs.ts`) is the only corner test | gone; corners are classified by bend radius against `ρmin` and `ρstyle` |
| `CONNECT_LIMIT = 0.75π` discourages connect on sharp turns | gone; a fillet either fits or it does not |
| `LOOP_RADIUS_FACTOR = 4`, justified by `CLEARANCE` | unchanged as a factor on `r`, justified instead by `≥ ρmin` |
| `sweepRadius` returns a shrunk radius | returns the run's tightest bend radius, as a diagnostic |

The lab's `report.ts` already computes "clamped" from `sweepRadius`. It reports the same runs under
the new meaning — runs whose path the corner stage failed to make bendable — and the acceptance
criterion is that the count is zero on `NSRE` for both shipped looks.

## Loops are closed rings that pass through themselves

`buildLoop` (`runs.ts`) splices a full 2π turn at a corner and lands **exactly** back on it, where
the incoming and outgoing tube also pass. Measured on `NSRE` with `corners: { loop: 1 }`, the
minimum distance between non-adjacent points of a run is 0.002–0.007 em against a tube diameter of
0.044: the tube is deep inside itself.

Two things are wrong beyond the missing advance:

- **The loop's plane is arbitrary.** It comes from `seedNormal(tangentIn)`, a basis-completion
  helper that picks whichever axis is least parallel to the tangent. For a generic tangent that is
  depth, and the loop stands 2R = 0.176 em proud of a 0.3 em extrusion. For an axis-aligned tangent
  — every corner of a rectilinear E or N — it is an in-plane axis instead, and the loop lies flat in
  the face, reaching up to 0.175 em outside the glyph's own bounding box. Both happen within one
  glyph, and which you get flips discontinuously with stroke direction. This is what the lab's
  `skeleton` panels show as rings hanging off the letter.
- **`LOOP_SEGMENTS = 28` fixes the point count, not the spacing.** At the shipped radius that
  happens to land on 0.0197 em, near `spacing`. It will not when `radius` moves.

**A pigtail is a substitution, not an insertion.** Take the sub-path spanning `L` of arc length
across the corner and rebuild it: the tube leaves that axis through a bend of radius `ρmin`, winds
one full turn of radius `LOOP_RADIUS_FACTOR · r` about it, and returns through a matching bend. Net
advance is `L` by construction, and it rejoins the path because its endpoints are on the path.

**The advance is what the construction has to buy, and it is not cheap.** The tangent has to wind
once around, so `∫κ ds ≥ 2π` and the pigtail is at least `2π·ρmin` — 0.276 em — of tube however it is
shaped. That length is affordable because a coil spends it sideways rather than forward. What is not
affordable is joining the coil to a straight path: a helix of radius `R` and pitch `p` meets its own
axis at `atan(2πR/p)`, so it never joins a straight run tangentially and needs a transition either
side.

Two constructions were measured, and neither is usable as written:

- **Ramp the winding radius up from the axis and back down** (a cosine ease over a half turn each
  side). Tangent-continuous by construction, but the ease is the whole cost: clearing `ρmin` through
  it needs a pitch of 0.55 em, an advance of 0.83 em. No run in the font is that long.
- **A circular arc of `ρmin` either side, into a helix.** Compact — advance `ρmin(2 sin α + π sin 2α)`
  is 0.11 em at `α = 85°`, and the coil radius falls out as `ρmin sin²α ≈ 2r`. But a single arc each
  side leaves the exit displaced sideways from the entry by `2ρmin(1 − cos α)` ≈ 0.08 em, and the
  coil's own turn returns to zero rather than cancelling it. The path jogs. Closing that needs either
  an S-shaped transition or a coil ended off a full turn, and both change the tangent the other piece
  has to match.

**`LOOP_RADIUS_FACTOR = 4` does not survive either way.** A ρmin transition can reach a winding
radius of at most `ρmin`, since `ρmin(1 − cos α) ≤ ρmin` for any usable `α < 90°`. A 4r coil is only
reachable by the ramp, at an advance no run can pay. Whoever builds this should expect the loop to be
about `2r` across, not `4r`, and should decide first whether a look that draws 15% of its corners as
loops is worth this much geometry — breaking those corners instead is measurably better than the
`buildLoop` that ships today, and costs nothing but the flourish.

Acceptance, all five:

1. Advance over the turn is at least `2r` plus clearance, so consecutive windings do not touch.
2. Position and tangent are continuous at both joins.
3. Bend radius is at least `ρmin` everywhere, **including the two transitions**. A bare helix fails
   here and it is the whole reason for the entry and exit bends: at `R = 4r` and a pitch of `2r`,
   the helix's tangent meets its own axis at 85°.
4. Minimum distance between non-adjacent parts of the pigtail is at least `2r` plus clearance.
5. It passes the same clearance query against other runs as a fillet. On failure the corner breaks.

The plane the pigtail winds in must be chosen rather than inherited — see below.

## A break is the one corner strategy with no counterpart in glass

`break` cuts the run and leaves two ends. Two things are wrong with that, one a defect and one a
model error.

**The defect: run ends are not closed.** `buildTubeGeometry` (`sweep.ts`) emits the swept wall and
nothing else — no cap at either end. Every run currently terminates in an open circular hole, which
the backing's transparency renders as a hard cut edge. Cap both ends with a hemisphere of the tube's
own radius, built from the same rotation-minimising frame as the last ring so the normals agree. This
is a fix, not a look decision, and it needs no spec field.

**The model error: a working neon unit has no free ends.** Every end is an electrode — a wider glass
sleeve, routed behind the sign face — or a seal left by tipping the tube off, which is a rounded dome
rather than a cut. Where a design needs a stroke to stop, a bender does not stop the tube: they bend
it out of the plane, run it behind, and paint that stretch with blockout so it carries current
without carrying light. The glass stays continuous; only the glow breaks.

**So a break should become a return.** Draw the corner exactly as `connect` does — the same fillet at
`ρmin` — and mark the stretch either side of it unlit. `Run` already carries `lit`, and `select`
already decides which runs glow, so the geometry is unchanged and the change is in what is lit. What
it buys is threefold: the silhouette stays whole, the invariant holds through a corner that used to
end two runs at it, and the strategy that has become the ordinary case stops being the one the
reference does not contain.

It needs one spec field, `blockout`, weighting return against cut, because a cut is still right at a
letter's real terminus — where an electrode would go. Default it to favour the return.

**The interaction to get right:** a return is a `connect` whose fillet has to fit. Where it does not,
the corner still cuts, and that cut end still needs its cap. Returns therefore do not remove the
break path; they make it the fallback rather than the default.

## Path fidelity is unblocked by this work, not part of it

**Settled: `pathSource` defaults to `direct`, and the measurement below was taken under a clamp that
no longer exists.** Tracing the contour deletes the grid's wobble and the corners it manufactured. It
does not delete group filleting: a corner spans 2-4 vertices under either source, which
`spikes/corner-width.mjs` measures on a square with no field anywhere near it.

The tube's path is not the font's curves. `glyphToShapes` yields real béziers; they are flattened at
24 segments per curve, resampled, rasterized into a signed distance field on a 256² grid,
re-extracted by marching squares, resampled again, and smoothed three times. Over a glyph bbox plus
`PAD = 0.35` on each side, one grid cell is 0.0054 em against a tube radius of 0.022 — half the
grid is empty margin. That rounding is why the letters read as melted.

`spikes/clamp-vs-blur.mjs` shows that sharpening the path makes the clamp **worse**:

```
        via SDF (shipped)          direct contour
N       worst 31%, 2/7 clamped     worst 16%, 2/7 clamped
S       worst 98%, 1/7             worst 69%, 1/7
R       worst 100%, 0/7            worst 43%, 3/5
E       worst 96%, 1/6             worst 48%, 3/6
```

The rasterization blur rounds corners, which raises curvature radius, which is the exact quantity
the clamp measures. **The blur is currently masking defect 1**, so the order is forced: the clamp
model has to land before the path sharpens, or the letters get thinner and more uneven.

Path fidelity is therefore a follow-on, not a third piece of work here — it cannot start until this
lands and is tuned, and it carries its own unrelated risks (`piping` traces at `level: -0.015`, so
the field is doing real work there and cannot simply be bypassed; the field's even-odd rasterization
also resolves overlapping contours, which a direct per-contour trace would not). What *is* in scope
is the requirement that the model hold at both fidelities: **run `spikes/clamp-vs-blur.mjs` as an
acceptance check and require zero unresolved corners on the direct-contour column too**, not only on
the shipped one.

The R dropping from 7 runs to 5 on the direct contour is the same coupling seen from the other side:
today one angle threshold serves both the physical and the stylistic job, so path fidelity moves run
segmentation. Splitting the two thresholds decouples them — hard corners mostly stop breaking once
they fillet, and the requested `runs` count fills in the rest by arc length as it already does.

## Settled

- **`bend` defaults to 2**, and the alphabet sweep supports it for a different reason than the one
  first given. `bend` barely classifies anything: the glyphs' corners are so much tighter than any
  admissible `ρmin` that 2 and 3 yield an **identical** hard-corner count (212 on `tubing`, 227 on
  `piping`). What `bend` actually sets is setback, and therefore how many fillets have no room and
  fall back to `break` — 2 on `tubing` and 7 on `piping` at `bend = 2`, against 9 and 17 at
  `bend = 3`. Two is the knee: under 1% of `tubing`'s fillets rejected, against 4% at three.
  It stays a per-look field, and `piping` is the candidate for a lower value — fabric cord bends
  tighter relative to its diameter than glass — but that is a tuning call the lab answers once the
  model is in, not a second default to guess now.
- **The pigtail winds in the depth plane.** It keeps the letter's silhouette intact, which matters
  most for a look whose job is to read as a sign, and it avoids the 0.175 em excursion outside the
  glyph bbox that the face plane produces today. It costs `2R = 0.176 em` of forward reach against a
  0.3 em extrusion, so it needs a cap — a pigtail that cannot fit within the cap breaks instead.
  Choosing the plane is itself part of the fix: today it is inherited from `seedNormal`, which picks
  whichever axis is least parallel to the tangent, so the plane flips discontinuously with stroke
  direction and one glyph gets both.
- **The inter-run clearance query ships in v1.** `radius` is a public spec field and a consumer can
  set it large, so a fillet that quietly pushes tube into tube is a defect waiting on someone else's
  parameter. It is one grid hash and one query per fillet sample.

## Baselines

**Two images moved, not four.** `look-tubing` and `offaxis-tubing` are re-recorded; `look-piping` and
`offaxis-piping` pass unchanged, because piping traces inset at `level: -0.015` and its cord is
inside the letter body in both framings. **The visual suite cannot see piping's cord at all**, so
piping's acceptance is `spikes/bend-acceptance.mjs`, not an image.

The re-record was done with the suite green at 24 and exactly those two failing first, so nothing
leaked. `--update-snapshots=all` rewrites every baseline; grep to the two that move.

## Acceptance, as measured

`node spikes/bend-acceptance.mjs`, whole pipeline, all 26 letters:

| | runs under `ρmin` | worst |
| --- | --- | --- |
| `tubing` | 2 of 231 | 1.94r |
| `tubing`, no wander | 1 of 207 | 1.91r |
| `piping` | 3 of 47 | 1.43r |

Against 33 of 42 when filleting was wired but only the tightest vertex of each corner was cut back.
The five that remain are within 5% of the invariant except `piping`'s `S`, and none is the kind of
gross violation the clamp and the loop splice produced.

What closed the gap, in order of what each was worth: filleting the corner's whole stretch rather
than one vertex of it, moving wander ahead of the cut so its bends are the corner stage's problem
(109 of 204 runs to 5), and dropping the loop.
