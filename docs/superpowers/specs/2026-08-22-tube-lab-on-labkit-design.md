# Tube lab on labkit — design

**For:** whoever implements the port. **Answers:** what labkit takes over, what klieg keeps, and
what will bite.

`@weasel-js/labkit` is a React widget set for interactive lab pages, published from the weasel
monorepo (`packages/labkit`). It now tiles with windease, which is what makes this worth doing: the
tube lab hand-rolls a tiling tree because the windease it is pinned to could not tile.

## What labkit takes over

**Tiling.** `WorkspaceGrid` owns a windease store, positions tiles at `gridStrategy` rects and
auto-balances to `ceil(sqrt(n))` columns — identical to today's arrangement for 1–16 panels. Pass
`resizable` for draggable seams and `reorderable` to drag a panel to a new slot; the grid reports
the order a drop would produce and the caller commits it. `src/tree.ts` is deleted, and with it
klieg's direct `windease` dependency: the pin is `^0.8.0`, labkit requires 1.2.1, and nothing in the
lab touches the store once the grid owns it.

**Tile identity.** Pass `ids` — panel ids, the ones `panels.ts` already assigns. Without them a tile
is identified by position, so closing one shifts every id after it and the panes inherit each
other's dragged extents.

**Persistence.** `persist.ts` splits in two: tile extents ride `layout` / `onLayoutChange`, and
letters, spec and look go through `useExperimentState` with `localStorageAdapter`. Read the
existing key once and migrate, rather than stranding saved sessions.

**Shell.** `LabShell` replaces the lab's own frame.

## What klieg keeps

**The renderer, unchanged.** `LabRenderer` draws sixteen panels from one `WebGLRenderer`, a scissor
rect each, because sixteen canvases would exhaust the browser's context budget. labkit has no
shared-surface host, so this stays klieg's. The canvas sits behind the grid in `.stage`; each tile
child is a div the lab measures, and its rect becomes that panel's scissor rect. Panels keep their
own pointer handling — drag-to-orbit and the reset button — since the canvas is behind them.

The change from today is only where rects come from: measured tile elements rather than windease
placements read directly.

**The spikes and the report path.** Untouched.

## The rail

`PropertyPanel` for the shell and row layout, but `@weasel-js/ui`'s `Slider` inside it rather than
labkit's `SliderRow`, which fires live. `Slider` splits `onInput` (during the drag) from `onChange`
(on release), and release is the only one the lab can afford: a spec change rebuilds all sixteen
cells, 1.45 s front-only and 2.85 s with back, wall and connectors.

Two things the rail needs and neither package has, so klieg wraps them for now:

- **Hints.** Every control carries hover text saying what it does and what it interacts with badly.
  A wrapper renders them; nothing in `ConfigField` or `PropertyPanel` carries one.
- **Stops.** `Slider`'s `constraint` is only `free` or `ordered`, so the wrapper snaps in `onInput`.

Both are filed against labkit (`packages/labkit/docs/IDEAS.md`), along with lens binding, inert-with-
a-reason and computed bounds. If they land, the wrapper collapses.

## Traps

**`WorkspaceGrid` puts `windease-zone` on its container**, whose `overflow: hidden` is exactly what
the lab withholds that class to escape. Keeping the canvas behind the grid rather than inside the
zone sidesteps it — verify visually before believing it, because a clipped canvas fails by drawing
nothing rather than by erroring.

**A tile rect is CSS pixels; the drawing buffer is device pixels.** The lab already scales by DPR
for its own canvas, but rects now arrive from `getBoundingClientRect`, so the conversion moves. A
display change alters DPR without altering any rect.

**Nothing measures in jsdom**, and a windease container renders no children at a zero measurement.
`WorkspaceGrid` takes a `viewport` prop for that; any test that mounts the grid needs it.

**A seam drag resizes panels continuously.** Resizing the renderer viewport is cheap, rebuilding a
`Word` is not — make sure a resize re-renders without rebuilding cells, or a drag costs seconds per
frame.

## Acceptance

- Sixteen panels draw, on one WebGL context, at the same visual result as today: capture the lab
  before and after and compare.
- Seam drags resize panels; the layout survives a reload.
- A slider drag still costs one rebuild, not one per frame — check by counting builds, not by feel.
- `npm run check` and `npx playwright test` stay green; the lab is dev-only, so the published
  package must not gain a dependency.
