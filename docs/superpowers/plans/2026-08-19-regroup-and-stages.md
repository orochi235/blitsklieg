# Regroup and Stages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an effect exit part of its word and lay the survivors out again as a new word, driven by the viewer's click.

**Architecture:** The layout arithmetic comes out of `Word`'s constructor into a pure `text/placement.ts`, so both the first layout and every regroup run the same code and both are testable without a GL context. `Word` gains `regroup()`, which re-places the survivors and reports how far each one must travel back to look unmoved — that delta feeds an ordinary `transition()`, so the move needs no new pose concept. A new `Sequence` plays one `Timeline` per stage and calls into `Word` at the boundaries.

**Tech Stack:** TypeScript, three.js, vitest. Source in `packages/core/src`, tests in `packages/core/test`, run from the repo root.

**Spec:** `docs/superpowers/specs/2026-08-19-text-runs-design.md`. Spans are deliberately *not* in this plan; they follow in their own.

---

## File Structure

**Created:**
- `packages/core/src/text/placement.ts` — pure layout placement: where each glyph sits in em, which line and column it is on, and the fit scale for a block. No three, no font objects beyond `GlyphMetrics`.
- `packages/core/src/motion/sequence.ts` — the stage runner. Owns the current stage's `Timeline` and calls the `StageTarget` at boundaries. No three.
- `packages/core/test/text/placement.test.ts`
- `packages/core/test/motion/sequence.test.ts`

**Modified:**
- `packages/core/src/motion/types.ts` — `LetterInfo` gains `x`/`y`.
- `packages/core/src/motion/build.ts` — `transition()` gains `delayBy`; new internal `partition()`.
- `packages/core/src/render/word.ts` — consumes `placement.ts`; gains `regroup()`, `retire()`, `setFitProgress()`, and a per-letter tint rule.
- `packages/core/src/index.ts` — `Stage`/`TweenSpec` types, `FireOptions.then`, a per-letter `tint`, wiring in `run()`.
- `packages/core/README.md` — document `then`.
- `apps/lab/src/main.ts` — an acrostic sequence.

---

### Task 1: Extract placement from Word's constructor

> **Landed** as `918076c`, plus review fixes. Three things diverged from the code blocks below, and
> every later task is written against the *landed* shape: `Placement` carries `char` and
> `inkWidth`; `fitOf` takes `(placed, geoMinY, geoMaxY, budget)`; and the assertions are glyph
> origins, so `place('AB')` gives `[-STEP, 0]`. Read `packages/core/src/text/placement.ts` for the
> current interface rather than this section.

`Word`'s constructor computes glyph positions, the per-line centring shift, and the viewport fit inline. A regroup has to redo all three, so they move to a pure module first. This task must not change any behavior — the existing `word.test.ts` suite is the check.

**Files:**
- Create: `packages/core/src/text/placement.ts`
- Create: `packages/core/test/text/placement.test.ts`
- Modify: `packages/core/src/render/word.ts:100-260`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/text/placement.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GlyphMetrics } from '../../src/text/layout.js';
import { layoutBlock } from '../../src/text/layout.js';
import { arrange, fitOf, placeBlock } from '../../src/text/placement.js';

const UPEM = 1000;
const ADVANCE = 600;
const SCALE_TO_EM = 1 / UPEM;
/** One advance in em. */
const STEP = ADVANCE / UPEM;

const metrics: GlyphMetrics = { advanceOf: () => ADVANCE, kernOf: () => 0 };
const drawsInk = (char: string) => char.trim().length > 0;

const place = (text: string) =>
  placeBlock(layoutBlock(text, metrics), SCALE_TO_EM, metrics, drawsInk);

describe('placeBlock', () => {
  it('centres a single line on x = 0', () => {
    const p = place('AB');
    // Positions are glyph origins, so the line spans x[0] to x[1] + one advance.
    expect(p.x[0]).toBeCloseTo(-STEP);
    expect(p.x[1]).toBeCloseTo(0);
  });

  it('centres each line independently', () => {
    const p = place('AB\nA');
    expect(p.x[2]).toBeCloseTo(-STEP / 2);
  });

  it('excludes a trailing space from the centring', () => {
    expect(place('AB ').x[0]).toBeCloseTo(place('AB').x[0]);
  });

  it('steps y down one line height per line', () => {
    const p = place('A\nB');
    expect(p.y[0]).toBeCloseTo(0);
    expect(p.y[1]).toBeCloseTo(-1.1);
  });

  it('reports line, column and counts', () => {
    const p = place('AB\nC');
    expect(p.line).toEqual([0, 0, 1]);
    expect(p.column).toEqual([0, 1, 0]);
    expect(p.lineCount).toBe(2);
    expect(p.columnCount).toBe(2);
  });
});

describe('arrange', () => {
  it('joins a line', () => {
    expect(arrange(['N', 'E', 'O'], 'line')).toBe('NEO');
  });

  it('breaks a stack one glyph per line', () => {
    expect(arrange(['N', 'E', 'O'], 'stack')).toBe('N\nE\nO');
  });
});

describe('fitOf', () => {
  it('scales a wide block down to the budget width', () => {
    const p = place('AAAA');
    const fit = fitOf(p, ['A', 'A', 'A', 'A'], [0, 0, 0, 0], [0.7, 0.7, 0.7, 0.7], metrics, SCALE_TO_EM, {
      width: 1,
      height: 10,
    });
    // Four 0.6em advances span 2.4em of ink; a 1-wide budget scales that by 1/2.4.
    expect(fit.scale).toBeCloseTo(1 / 2.4, 4);
  });

  it('puts the vertical centre of the ink at midY', () => {
    const p = place('A');
    const fit = fitOf(p, ['A'], [-0.2], [0.7], metrics, SCALE_TO_EM, { width: 100, height: 100 });
    expect(fit.midY).toBeCloseTo(0.25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/text/placement.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/text/placement.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/text/placement.ts`:

```ts
import type { Block, Budget, GlyphMetrics, Line } from './layout.js';
import { fitScale, LINE_HEIGHT_EM } from './layout.js';

/** How a regrouped word is laid out: one line, or one glyph per line. */
export type Arrangement = 'line' | 'stack';

export interface Placement {
  /** Layout x per glyph, in em, already centred on its own line. */
  x: number[];
  /** Layout y per glyph, in em, before the block's vertical centring. */
  y: number[];
  line: number[];
  column: number[];
  lineCount: number;
  /** The widest line's glyph count, so a short line's columns do not stretch to fill it. */
  columnCount: number;
}

/** The string that lays `chars` out in the given arrangement. */
export function arrange(chars: readonly string[], as: Arrangement): string {
  return chars.join(as === 'stack' ? '\n' : '');
}

/**
 * Positions every glyph of a laid-out block. Each line centres on x = 0 across the glyphs that
 * draw ink — spanning `line.width` instead would push a line with a trailing space off centre.
 */
export function placeBlock(
  block: Block,
  scaleToEm: number,
  metrics: GlyphMetrics,
  drawsInk: (char: string) => boolean,
): Placement {
  const out: Placement = {
    x: [],
    y: [],
    line: [],
    column: [],
    lineCount: block.lines.length,
    columnCount: Math.max(0, ...block.lines.map((l) => l.glyphs.length)),
  };

  for (let ln = 0; ln < block.lines.length; ln++) {
    const line = block.lines[ln] as Line;
    const y = -ln * LINE_HEIGHT_EM;
    const first = out.x.length;
    let inkStart: number | null = null;
    let inkEnd = 0;

    for (const g of line.glyphs) {
      const x = g.x * scaleToEm;
      out.x.push(x);
      out.y.push(y);
      out.line.push(ln);
      out.column.push(g.index);
      if (drawsInk(g.char)) {
        inkStart ??= x;
        inkEnd = x + metrics.advanceOf(g.char) * scaleToEm;
      }
    }

    const shift = inkStart === null ? 0 : -(inkStart + inkEnd) / 2;
    for (let i = first; i < out.x.length; i++) out.x[i] = (out.x[i] as number) + shift;
  }

  return out;
}

export interface Fit {
  scale: number;
  /** Vertical centre of the drawn ink, in em. The group shifts by `-midY * scale`. */
  midY: number;
}

/**
 * Uniform scale and vertical centring for a placed block. `geoMinY`/`geoMaxY` are each glyph's
 * own vertical bounds in em, indexed like the placement; a glyph that draws nothing contributes
 * neither. Ink height, not cap height: a descender both drops the centre and eats budget.
 */
export function fitOf(
  placed: Placement,
  chars: readonly string[],
  geoMinY: readonly (number | null)[],
  geoMaxY: readonly (number | null)[],
  metrics: GlyphMetrics,
  scaleToEm: number,
  budget: Budget,
): Fit {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < placed.x.length; i++) {
    const lo = geoMinY[i];
    const hi = geoMaxY[i];
    if (lo === null || lo === undefined || hi === null || hi === undefined) continue;
    const y = placed.y[i] as number;
    minY = Math.min(minY, y + lo);
    maxY = Math.max(maxY, y + hi);
    const x = placed.x[i] as number;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + metrics.advanceOf(chars[i] as string) * scaleToEm);
  }

  const drawn = Number.isFinite(minY);
  const width = Number.isFinite(minX) ? maxX - minX : 0;
  return {
    scale: fitScale(width, drawn ? maxY - minY : 0, budget),
    midY: drawn ? (minY + maxY) / 2 : 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/text/placement.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Rewrite Word's constructor against it**

In `packages/core/src/render/word.ts`, add to the imports:

```ts
import type { LetterInfo } from '../motion/types.js';
import type { GlyphMetrics, PlacedGlyph } from '../text/layout.js';
import { arrange, type Arrangement, type Fit, fitOf, placeBlock } from '../text/placement.js';
```

`Budget` and `Line` are already imported from `./text/layout.js`; add `GlyphMetrics` and
`PlacedGlyph` to that existing type import rather than writing a second one.

Add these fields beside the existing `baseX`/`baseY` declarations:

```ts
  /** Every glyph's character, so a regroup can lay the survivors out again. */
  private readonly charOf: string[] = [];
  /** Per-letter vertical bounds in em; null where the glyph drew nothing. */
  private readonly geoMinY: (number | null)[] = [];
  private readonly geoMaxY: (number | null)[] = [];
  private readonly metrics: GlyphMetrics;
  private fit: Fit;
```

Only these. Biome's `noUnusedPrivateClassMembers` rejects a private field nothing reads, so
`scaleToEm`, `budget`, `fitFrom`, `fitTo` and `liveCount` cannot be declared until the task that
reads them — Task 2 for `liveCount`, Task 4 for the rest.

Replace the whole per-line loop (the `for (let ln = 0; ...)` block) and the fit block that follows it with:

```ts
    this.metrics = font.metrics;
    this.scaleToEm = scaleToEm;
    this.budget = budget;

    const placed = placeBlock(block, scaleToEm, font.metrics, (char) => this.drawsInk(char));
    this.lineCount = placed.lineCount;
    this.columnCount = placed.columnCount;

    // Bounds first, cells second. The glyph cache memoizes on (char, depth), so measuring every
    // glyph before building anything costs one extra map lookup per letter — and it settles the
    // fit, which a per-letter tint callback needs in order to be handed a meaningful `y`.
    for (let i = 0; i < placed.x.length; i++) {
      const line = block.lines[placed.line[i] as number] as Line;
      const g = line.glyphs[placed.column[i] as number] as PlacedGlyph;
      const geo = this.cache.get(g.char, DEFAULT_GLYPH_OPTIONS.depth);
      const drawn = geo.attributes.position?.count ? geo.boundingBox : null;
      this.charOf.push(g.char);
      this.baseX.push(placed.x[i] as number);
      this.baseY.push(placed.y[i] as number);
      this.lineOf.push(placed.line[i] as number);
      this.columnOf.push(placed.column[i] as number);
      this.idxOf.push(i);
      this.frozenInfo.push(null);
      this.geoMinY.push(drawn ? drawn.min.y : null);
      this.geoMaxY.push(drawn ? drawn.max.y : null);
    }
    this.liveCount = placed.x.length;

    this.fit = fitOf(
      placed,
      this.charOf,
      this.geoMinY,
      this.geoMaxY,
      font.metrics,
      scaleToEm,
      budget,
    );
    this.fitFrom = this.fit;
    this.fitTo = this.fit;
    this.applyFit(this.fit);

    for (let i = 0; i < this.charOf.length; i++) {
      this.buildCell(i, font, look, spec, decoration, tint, debug);
    }
```

Move the body of the old inner `for (const g of line.glyphs)` loop into a private `buildCell(i, font, look, spec, decoration, tint, debug)` method. It reads its character as `this.charOf[i]`, no longer pushes to `baseX`/`baseY`/`lineOf`/`columnOf`/`geoMinY`/`geoMaxY`, and sets the cell's position from the arrays already filled:

```ts
    cell.position.set(this.baseX[i] as number, this.baseY[i] as number, 0);
```

Where the old loop `continue`d on a glyph with no geometry, `buildCell` returns early after pushing `null` into the three material arrays.

Add the two helpers:

```ts
  /** A glyph draws ink when its geometry has vertices — the same test the cell build uses. */
  private drawsInk(char: string): boolean {
    return this.cache.get(char, DEFAULT_GLYPH_OPTIONS.depth).attributes.position?.count
      ? true
      : false;
  }

  private applyFit(fit: Fit): void {
    this.group.scale.setScalar(fit.scale);
    this.group.position.set(0, -fit.midY * fit.scale, 0);
  }
```

Add `idxOf` beside the other index arrays:

```ts
  /** Reading position within the live group; a regroup renumbers it. */
  private readonly idxOf: number[] = [];
  /** Set on a letter a regroup dropped; its info stops tracking the live group. */
  private readonly frozenInfo: (LetterInfo | null)[] = [];
  /** Letters still in the group — not `letters.length`, which counts the retired ones too. */
  private liveCount = 0;
```

`frozenInfo` and `liveCount` are filled by the constructor loop above and read by Task 2's
`letterInfo()`; nothing in this task consumes them yet.

- [ ] **Step 6: Run the existing Word suite to verify nothing moved**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: PASS, all existing tests, no changes to that file.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/text/placement.ts packages/core/test/text/placement.test.ts packages/core/src/render/word.ts
git commit -m "extract glyph placement and fit out of Word's constructor"
```

---


### Task 2: LetterInfo carries the letter's laid-out position

**Files:**
- Modify: `packages/core/src/motion/types.ts:3-16`
- Modify: `packages/core/src/render/word.ts` (the `apply` method)
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/word.test.ts`:

```ts
describe('LetterInfo position', () => {
  it('hands each letter its laid-out position in em', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
    );
    // Glyph origins, centred on the advance span: 'AB' puts A at -STEP and B at 0.
    expect(seen[0]?.x).toBeCloseTo(-STEP);
    expect(seen[1]?.x).toBeCloseTo(0);
  });

  it('measures y from the block centre, so a single line sits at zero', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
    );
    // The stub's 'A' spans 0..0.7em, so its centre is 0.35 below the glyph origin.
    expect(seen[0]?.y).toBeCloseTo(-0.35);
  });

  it('separates two lines by one line height', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
    );
    expect((seen[0]?.y as number) - (seen[1]?.y as number)).toBeCloseTo(1.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/word.test.ts -t "laid-out position"`
Expected: FAIL — `expected undefined to be close to -0.3`.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/motion/types.ts`, extend `LetterInfo`:

```ts
  /** Layout position in em, relative to the block centre. Negate it to travel to the centre. */
  x?: number;
  y?: number;
  /** True once a regroup has dropped this letter: it is playing its exit and will not be back. */
  leaving?: boolean;
```

In `packages/core/src/render/word.ts`, replace the inline object in `apply()` with a call to a new method, and add it:

```ts
  /** Fresh each call: a caller-supplied piece receives this, and a reused object would alias. */
  private letterInfo(i: number): LetterInfo {
    const frozen = this.frozenInfo[i];
    if (frozen) return { ...frozen, leaving: true };
    return {
      index: this.idxOf[i] as number,
      count: this.liveCount,
      line: this.lineOf[i] as number,
      column: this.columnOf[i] as number,
      lineCount: this.lineCount,
      columnCount: this.columnCount,
      x: this.baseX[i] as number,
      y: (this.baseY[i] as number) - this.fit.midY,
    };
  }
```

`frozenInfo` already exists. `liveCount` does not: biome's `noUnusedPrivateClassMembers` rejects a
private field nothing reads, so Task 1 could only declare the ones it also read. Declare it here,
and set it to `placed.x.length` at the end of the constructor loop Task 1 wrote:

```ts
  /** Letters still in the group — not `letters.length`, which counts the retired ones too. */
  private liveCount = 0;
```

`leavingAt()` belongs to Task 4, not here — nothing in this task calls it, and biome flags an
unread private member. `lineCount` and `columnCount` must stop being `readonly` — a regroup rewrites them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: PASS, including the three new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/motion/types.ts packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "give every letter its laid-out position through LetterInfo"
```

---


### Task 3: Per-channel delay on transition()

**Files:**
- Modify: `packages/core/src/motion/build.ts:13-70`
- Test: `packages/core/test/motion/build.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/motion/build.test.ts`:

```ts
describe('delayBy', () => {
  const letter: LetterInfo = { index: 0, count: 1 };

  it('holds a delayed channel at its start value through the delay', () => {
    const piece = transition(100, {
      from: { position: [10, 0, 0], scale: 2 },
      ease: linear,
      delayBy: { scale: 0.5 },
    });
    const half = piece.offset(0.5, letter);
    // Position is half done; scale has not started.
    expect(half.position?.[0]).toBeCloseTo(5);
    expect(half.scale).toBeCloseTo(2);
  });

  it('still lands the delayed channel at rest by the end of the pass', () => {
    const piece = transition(100, {
      from: { scale: 2 },
      ease: linear,
      delayBy: { scale: 0.5 },
    });
    expect(piece.offset(0.75, letter).scale).toBeCloseTo(1.5);
    expect(piece.offset(1, letter).scale).toBeCloseTo(1);
  });

  it('leaves undelayed channels alone', () => {
    const piece = transition(100, { from: { position: [10, 0, 0] }, ease: linear, delayBy: {} });
    expect(piece.offset(0.5, letter).position?.[0]).toBeCloseTo(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/motion/build.test.ts -t "delayBy"`
Expected: FAIL — TypeScript rejects `delayBy` as an unknown property of `TransitionSpec`.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/motion/build.ts`, add to `TransitionSpec`:

```ts
  /** Fraction of the pass a channel waits before it starts moving. */
  delayBy?: Partial<Record<Channel, number>>;
```

Change `between()` to take the delays and re-map `s` per channel:

```ts
function between(
  a: PoseOffset,
  b: PoseOffset,
  s: number,
  ease: Easing,
  easeBy: TransitionSpec['easeBy'],
  delayBy: TransitionSpec['delayBy'],
): PoseOffset {
  const at = (channel: Channel) => {
    const delay = Math.min(0.999, Math.max(0, delayBy?.[channel] ?? 0));
    const local = Math.max(0, (s - delay) / (1 - delay));
    return (easeBy?.[channel] ?? ease)(Math.min(1, local));
  };
  ...
}
```

Thread `spec.delayBy` through both `between()` call sites in `transition()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/motion/build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/motion/build.ts packages/core/test/motion/build.test.ts
git commit -m "let a transition delay one channel behind the others"
```

---


### Task 4: Word.regroup and the fit tween

**Files:**
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/word.test.ts`:

```ts
describe('regroup', () => {
  const firstOfLine = (l: LetterInfo) => l.column === 0;

  it('lays the survivors out as the word they spell', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    const result = word.regroup(firstOfLine, 'line');
    expect(result.kept).toEqual([0, 2, 4]);
    expect(result.dropped).toEqual([1, 3, 5]);

    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
    );
    // Three survivors on one line, origins centred on the advance span.
    expect(seen[0]?.x).toBeCloseTo(-1.5 * STEP);
    expect(seen[2]?.x).toBeCloseTo(-0.5 * STEP);
    expect(seen[4]?.x).toBeCloseTo(0.5 * STEP);
  });

  it('stacks one survivor per line when asked', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'stack');
    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
    );
    expect(seen[0]?.line).toBe(0);
    expect(seen[2]?.line).toBe(1);
    expect(seen[0]?.x).toBeCloseTo(-STEP / 2);
  });

  it('renumbers the survivors and leaves the dropped letters their old numbering', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'line');
    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
    );
    expect([seen[0]?.index, seen[2]?.index]).toEqual([0, 1]);
    expect([seen[0]?.count, seen[2]?.count]).toEqual([2, 2]);
    // The dropped letter keeps the numbering its exit was staggered against.
    expect(seen[1]?.index).toBe(1);
    expect(seen[1]?.count).toBe(4);
  });

  it('reports the offset that puts a survivor back where it was', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    const before: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        before.push({ ...letter });
        return {};
      }),
      0,
    );
    const result = word.regroup(firstOfLine, 'line');
    const after: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        after.push({ ...letter });
        return {};
      }),
      0,
    );
    const [dx] = result.delta[0] as [number, number];
    expect((after[0]?.x as number) + dx).toBeCloseTo(before[0]?.x as number);
  });

  it('leaves a dropped letter parked where it was', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    const before: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        before.push({ ...letter });
        return {};
      }),
      0,
    );
    word.regroup(firstOfLine, 'line');
    const after: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        after.push({ ...letter });
        return {};
      }),
      0,
    );
    expect(after[1]?.x).toBeCloseTo(before[1]?.x as number);
  });

  it('matches laying the survivors out directly', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'line');
    const regrouped: number[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        regrouped.push(letter.x as number);
        return {};
      }),
      0,
    );

    const direct = new Word('NEO', stubFont(), 'gold', ROOMY);
    const plain: number[] = [];
    direct.apply(
      timelineOf((_t, letter) => {
        plain.push(letter.x as number);
        return {};
      }),
      0,
    );
    expect([regrouped[0], regrouped[2], regrouped[4]]).toEqual(plain);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/word.test.ts -t "regroup"`
Expected: FAIL — `word.regroup is not a function`.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/render/word.ts`:

`Word` imports the result type from the sequence rather than declaring a second name for the same
shape — `sequence.ts` does not import `word.ts`, so there is no cycle:

```ts
import type { RegroupResult } from '../motion/sequence.js';
```

Task 7 creates that module. Until it exists, declare the interface locally in `word.ts` and move it
in Task 7:

```ts
export interface RegroupResult {
  /** Slot indices that survived, in their new reading order. */
  kept: number[];
  /** Slot indices that did not; still parked at their old layout positions. */
  dropped: number[];
  /** Per slot, the offset from the new layout position back to the old one. */
  delta: [number, number][];
}
```

```ts
  /**
   * Re-lays the letters `keep` selects as a word of their own. Survivors are renumbered against
   * the new group; a dropped letter keeps the numbering its exit was staggered against, and stays
   * at its old position until `retire()` takes it off screen.
   */
  /** A letter on its way out, so a stage's slot can tell the two halves apart. */
  private leavingAt(i: number): boolean {
    return this.frozenInfo[i] !== null && this.frozenInfo[i] !== undefined;
  }

  regroup(keep: (letter: LetterInfo) => boolean, as: Arrangement = 'line'): RegroupResult {
    const kept: number[] = [];
    const dropped: number[] = [];
    const delta: [number, number][] = this.letters.map(() => [0, 0]);

    for (let i = 0; i < this.letters.length; i++) {
      if (this.leavingAt(i)) continue;
      (keep(this.letterInfo(i)) ? kept : dropped).push(i);
    }

    for (const i of dropped) this.frozenInfo[i] = this.letterInfo(i);

    const chars = kept.map((i) => this.charOf[i] as string);
    const block = layoutBlock(arrange(chars, as), this.metrics);
    const placed = placeBlock(block, this.scaleToEm, this.metrics, (char) =>
      this.drawsInk(char),
    );

    this.lineCount = placed.lineCount;
    this.columnCount = placed.columnCount;
    this.liveCount = kept.length;

    for (let n = 0; n < kept.length; n++) {
      const i = kept[n] as number;
      const oldX = this.baseX[i] as number;
      const oldY = this.baseY[i] as number;
      this.baseX[i] = placed.x[n] as number;
      this.baseY[i] = placed.y[n] as number;
      this.lineOf[i] = placed.line[n] as number;
      this.columnOf[i] = placed.column[n] as number;
      this.idxOf[i] = n;
      delta[i] = [oldX - (this.baseX[i] as number), oldY - (this.baseY[i] as number)];
    }

    this.fitFrom = this.fit;
    this.fitTo = fitOf(
      placed,
      kept.map((i) => this.geoMinY[i] ?? null),
      kept.map((i) => this.geoMaxY[i] ?? null),
      this.budget,
    );

    return { kept, dropped, delta };
  }

  /** Takes dropped letters off screen once their exit has played out. */
  retire(slots: readonly number[]): void {
    for (const i of slots) {
      const cell = this.letters[i];
      if (cell) cell.visible = false;
    }
  }
```

Three more fields have to be declared here for the same reason `liveCount` was deferred to Task 2 — biome rejects a private field nothing reads, so Task 1 could not carry them:

```ts
  private readonly scaleToEm: number;
  private readonly budget: Budget;
  /** The fit before this regroup; `fit` interpolates between this and `fitTo`. */
  private fitFrom: Fit;
  private fitTo: Fit;
```

The constructor sets `scaleToEm`, `budget`, and both fits alongside the `metrics` assignment Task 1 added. The fit tween in the second half of this task is what reads `fitFrom`/`fitTo`, which is why the two halves cannot be separate commits.

`word.ts` already imports `layoutBlock` from `./text/layout.js` for the constructor.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: PASS.

The new group is a different size, so its viewport fit differs. Scaling it at the same time as the letters travel is what makes the move hard to tune, so the fit runs on its own progress value that the stage delays.

- [ ] **Step 5: Write the failing test**

Append to `packages/core/test/render/word.test.ts`:

```ts
describe('fit tween', () => {
  const firstOfLine = (l: LetterInfo) => l.column === 0;
  const TIGHT: Budget = { width: 2, height: 2 };

  it('holds the old fit at progress 0 and reaches the new one at 1', () => {
    const word = new Word('NAAAA\nEBBBB', stubFont(), 'gold', TIGHT);
    const before = word.group.scale.x;
    word.regroup(firstOfLine, 'line');

    word.setFitProgress(0);
    expect(word.group.scale.x).toBeCloseTo(before);

    word.setFitProgress(1);
    // Two letters need far less width than ten, so the fit grows.
    expect(word.group.scale.x).toBeGreaterThan(before);
  });

  it('is halfway between the two at progress 0.5', () => {
    const word = new Word('NAAAA\nEBBBB', stubFont(), 'gold', TIGHT);
    const before = word.group.scale.x;
    word.regroup(firstOfLine, 'line');
    word.setFitProgress(1);
    const after = word.group.scale.x;
    word.setFitProgress(0.5);
    expect(word.group.scale.x).toBeCloseTo((before + after) / 2);
  });

  it('reports y against the settled fit once the tween completes', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'line');
    word.setFitProgress(1);
    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_t, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
    );
    // One line of survivors: its own centre.
    expect(seen[0]?.y).toBeCloseTo(-0.35);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/word.test.ts -t "fit tween"`
Expected: FAIL — `word.setFitProgress is not a function`.

- [ ] **Step 7: Write the implementation**

`fitFrom` and `fitTo` already exist — Task 1 set them, Task 4 updates them. All this task adds is
the interpolation:

```ts
  /**
   * Moves the viewport fit from the pre-regroup one to the new group's, `u` in 0..1. Kept off the
   * per-letter pose deliberately: pose scale grows each letter in place, where the fit has to
   * scale the whole group so the letters spread with it.
   */
  setFitProgress(u: number): void {
    const w = Math.max(0, Math.min(1, u));
    this.fit = {
      scale: this.fitFrom.scale + (this.fitTo.scale - this.fitFrom.scale) * w,
      midY: this.fitFrom.midY + (this.fitTo.midY - this.fitFrom.midY) * w,
    };
    this.applyFit(this.fit);
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "let a Word regroup its letters into a new layout and tween the fit"
```

---


### Task 5: partition()

A stage runs two different motions at once — survivors travel, the rest exit — and a `Timeline` composes one slot per letter. `partition` is how one slot carries both.

**Files:**
- Modify: `packages/core/src/motion/build.ts`
- Test: `packages/core/test/motion/build.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/motion/build.test.ts`:

```ts
describe('partition', () => {
  const kept: MotionPiece = { duration: 100, offset: () => ({ position: [1, 0, 0] }) };
  const dropped: MotionPiece = { duration: 300, offset: () => ({ position: [0, 2, 0] }) };
  const piece = partition((l) => l.index === 0, kept, dropped);

  it('runs the kept piece where the predicate holds', () => {
    expect(piece.offset(0.5, { index: 0, count: 2 }).position).toEqual([1, 0, 0]);
  });

  it('runs the dropped piece elsewhere', () => {
    expect(piece.offset(0.5, { index: 1, count: 2 }).position).toEqual([0, 2, 0]);
  });

  it('lasts as long as its longer half', () => {
    expect(piece.duration).toBe(300);
  });
});
```

Add `partition` to that file's import from `../../src/motion/build.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/motion/build.test.ts -t "partition"`
Expected: FAIL — no exported member `partition`.

- [ ] **Step 3: Write the implementation**

Append to `packages/core/src/motion/build.ts`:

```ts
/** One piece for the letters a predicate keeps, another for the rest. */
export function partition(
  keep: (letter: LetterInfo) => boolean,
  kept: MotionPiece,
  dropped: MotionPiece,
): MotionPiece {
  return {
    duration: Math.max(kept.duration, dropped.duration),
    offset: (t, letter) => (keep(letter) ? kept.offset(t, letter) : dropped.offset(t, letter)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/motion/build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/motion/build.ts packages/core/test/motion/build.test.ts
git commit -m "add a partition combinator for splitting a slot by predicate"
```

---


### Task 6: The Sequence

**Files:**
- Create: `packages/core/src/motion/sequence.ts`
- Create: `packages/core/test/motion/sequence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/motion/sequence.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { Sequence, type StagePlan, type StageTarget } from '../../src/motion/sequence.js';
import type { LetterInfo, MotionPiece } from '../../src/motion/types.js';
import { NONE } from '../../src/motion/types.js';

const letter: LetterInfo = { index: 0, count: 2, x: 0, y: 0 };

function target(): StageTarget & { regroups: number; retired: number[][]; fit: number[] } {
  const calls = {
    regroups: 0,
    retired: [] as number[][],
    fit: [] as number[],
    regroup: () => {
      calls.regroups++;
      return { kept: [0], dropped: [1], delta: [[3, 4] as [number, number], [0, 0]] };
    },
    retire: (slots: readonly number[]) => calls.retired.push([...slots]),
    setFitProgress: (u: number) => calls.fit.push(u),
  };
  return calls;
}

const stage = (over: Partial<StagePlan> = {}): StagePlan => ({
  exit: NONE,
  active: NONE,
  hold: 100,
  tween: { duration: 200 },
  ...over,
});

describe('Sequence', () => {
  it('regroups when it enters a stage, and not before', () => {
    const t = target();
    const seq = new Sequence({
      enter: { duration: 100, offset: () => ({}) } as MotionPiece,
      stages: [stage()],
      exit: NONE,
      hold: 50,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    expect(t.regroups).toBe(0);
    seq.tick(160);
    expect(t.regroups).toBe(1);
  });

  it('starts a survivor at the offset that hides the move, and lands it at rest', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      stages: [stage()],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    expect(seq.poseAt(0, letter).position[0]).toBeCloseTo(3);
    expect(seq.poseAt(200, letter).position[0]).toBeCloseTo(0);
  });

  it('retires the dropped letters once the move is done', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      stages: [stage()],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    expect(t.retired).toEqual([]);
    seq.tick(201);
    expect(t.retired).toEqual([[1]]);
  });

  it('delays the fit behind the move', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      stages: [stage({ tween: { duration: 200, delayBy: { scale: 0.5 } } })],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    seq.tick(100);
    expect(t.fit.at(-1)).toBeCloseTo(0);
    seq.tick(200);
    expect(t.fit.at(-1)).toBeCloseTo(1);
  });

  it('advances one stage per release and no more', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      stages: [stage({ hold: 'click' }), stage({ hold: 'click' })],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    seq.release(10);
    seq.release(11);
    seq.tick(400);
    expect(t.regroups).toBe(2);
  });

  it('finishes after the last stage and the exit', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      stages: [stage()],
      exit: { duration: 100, offset: () => ({}) } as MotionPiece,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    expect(seq.isFinished(100)).toBe(false);
    seq.tick(400);
    expect(seq.isFinished(401)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/motion/sequence.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/motion/sequence.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/motion/sequence.ts`:

```ts
import { type Easing, easeOutCubic } from '../easing.js';
import type { Pose } from '../pose.js';
import type { Arrangement } from '../text/placement.js';
import { partition, transition } from './build.js';
import { blankPose, type Slot, slotDuration, Timeline } from './compositor.js';
import type { LetterInfo, MotionPiece } from './types.js';
import { NONE } from './types.js';

/** What a regroup told the sequence about the letters it moved. Task 4 declared this in
 * `word.ts`; move the declaration here and have `word.ts` import it. */
export interface RegroupResult {
  kept: number[];
  dropped: number[];
  delta: [number, number][];
}

/** The `Word` side of a stage boundary, narrow enough to stub in a test. */
export interface StageTarget {
  regroup(keep: (letter: LetterInfo) => boolean, as: Arrangement | undefined): RegroupResult;
  retire(slots: readonly number[]): void;
  setFitProgress(u: number): void;
}

export interface TweenPlan {
  duration?: number;
  ease?: Easing;
  /** Fraction of the move a channel waits before starting. `scale` addresses the viewport fit. */
  delayBy?: { position?: number; scale?: number };
}

export interface StagePlan {
  keep?: (letter: LetterInfo) => boolean;
  exit: Slot;
  as?: Arrangement;
  active: Slot;
  hold: number | 'click';
  tween: TweenPlan;
}

export interface SequenceOptions {
  enter: Slot;
  stages: StagePlan[];
  exit: Slot;
  hold: number | 'click';
  blendMs: number;
  target: StageTarget;
}

const DEFAULT_MOVE_MS = 700;

/**
 * Plays the opening phase, then one stage after another, then the exit. Each phase is an ordinary
 * `Timeline` on its own clock; the sequence is what happens between them — the regroup, retiring
 * the letters that left, and the viewport fit catching up.
 */
export class Sequence {
  private readonly opts: SequenceOptions;
  private phase = -1;
  private phaseStart = 0;
  private timeline: Timeline;
  private pending: RegroupResult | null = null;
  private moveMs = 0;
  private fitDelay = 0;
  private retiredThisPhase = false;

  constructor(opts: SequenceOptions) {
    this.opts = opts;
    this.timeline = this.openingTimeline();
  }

  private openingTimeline(): Timeline {
    const last = this.opts.stages.length === 0;
    return new Timeline({
      enter: this.opts.enter,
      active: NONE,
      exit: last ? this.opts.exit : NONE,
      hold: this.opts.hold === 'click' ? 'until-release' : this.opts.hold,
      blendMs: this.opts.blendMs,
    });
  }

  /** Advances the stage if the current phase has run out, and keeps the fit moving. */
  tick(elapsed: number): void {
    while (this.phase < this.opts.stages.length && this.timeline.isFinished(this.local(elapsed))) {
      this.enterNextPhase(elapsed);
    }
    if (this.pending && this.moveMs > 0) {
      const into = this.local(elapsed);
      const span = this.moveMs * (1 - this.fitDelay);
      const u = span > 0 ? (into - this.moveMs * this.fitDelay) / span : 1;
      this.opts.target.setFitProgress(Math.max(0, Math.min(1, u)));
      if (!this.retiredThisPhase && into >= this.moveMs) {
        this.retiredThisPhase = true;
        this.opts.target.retire(this.pending.dropped);
      }
    }
  }

  private enterNextPhase(elapsed: number): void {
    this.phase++;
    const plan = this.opts.stages[this.phase];
    this.phaseStart = elapsed;
    this.retiredThisPhase = false;
    if (!plan) return;

    const keep = plan.keep ?? (() => true);
    const result = this.opts.target.regroup(keep, plan.as);
    this.pending = result;

    const move = plan.tween.duration ?? DEFAULT_MOVE_MS;
    this.moveMs = move;
    this.fitDelay = Math.min(0.999, Math.max(0, plan.tween.delayBy?.scale ?? 0));

    const travel = transition(move, {
      from: (letter) => {
        const slot = result.kept[letter.index];
        const d = slot === undefined ? undefined : result.delta[slot];
        return d ? { position: [d[0], d[1], 0] } : {};
      },
      ease: plan.tween.ease ?? easeOutCubic,
      delayBy: plan.tween.delayBy?.position ? { position: plan.tween.delayBy.position } : undefined,
    });

    // `leaving` is the only reliable discriminator here: a dropped letter keeps its old index, so
    // indexing `result.kept` by it would sometimes land on a live slot and route it to the wrong half.
    const isKept = (letter: LetterInfo) => letter.leaving !== true;

    const last = this.phase === this.opts.stages.length - 1;
    this.timeline = new Timeline({
      enter: partition(isKept, travel, asPiece(plan.exit)),
      active: plan.active,
      exit: last ? this.opts.exit : NONE,
      hold: plan.hold === 'click' ? 'until-release' : plan.hold,
      blendMs: this.opts.blendMs,
    });
  }

  private local(elapsed: number): number {
    return Math.max(0, elapsed - this.phaseStart);
  }

  release(elapsed: number): void {
    this.timeline.release(this.local(elapsed));
  }

  isFinished(elapsed: number): boolean {
    return (
      this.phase >= this.opts.stages.length - 1 && this.timeline.isFinished(this.local(elapsed))
    );
  }

  poseAt(elapsed: number, letter: LetterInfo, out: Pose = blankPose()): Pose {
    return this.timeline.poseAt(this.local(elapsed), letter, out);
  }
}

/** A layered slot collapses to one piece so `partition` can take it as a single branch. */
function asPiece(slot: Slot): MotionPiece {
  if (!Array.isArray(slot)) return slot;
  return {
    duration: slotDuration(slot),
    offset: (t, letter) => {
      const out: Pose = blankPose();
      for (const piece of slot) {
        const o = piece.offset(t, letter);
        if (o.position) for (let i = 0; i < 3; i++) out.position[i] += o.position[i] as number;
        if (o.rotation) for (let i = 0; i < 3; i++) out.rotation[i] += o.rotation[i] as number;
        if (o.scale !== undefined) out.scale *= o.scale;
        if (o.opacity !== undefined) out.opacity *= o.opacity;
      }
      return out;
    },
  };
}
```

The `phase` counter starts at `-1` so the first `tick` runs the opening `Timeline` without regrouping; `enterNextPhase` is only reached once that timeline reports finished.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/motion/sequence.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/motion/sequence.ts packages/core/test/motion/sequence.test.ts
git commit -m "play staged regroups from a sequence of timelines"
```

---


### Task 7: Wire `then` into fire()

**Files:**
- Modify: `packages/core/src/index.ts:114-155` and the body of `run()`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/index.test.ts`, inside the existing `describe('createBlitsklieg')`. That file already provides `create()` and a module-level `clock: ManualClock` reset in `beforeEach`, plus `stubFont`/`stubStage`/`stubWebgl`/`stubFetch` — use them exactly as the neighbouring tests do.

```ts
  describe('then', () => {
    it('plays a stage list and resolves once the whole thing has played', async () => {
      const bk = create();
      const done = bk.fire('NA\nEB', {
        enter: 'none',
        exit: 'none',
        hold: 10,
        then: [{ keep: (l) => l.column === 0, exit: 'fade', as: 'line', hold: 10 }],
      });
      await Promise.resolve();
      for (let t = 0; t < 60; t++) clock.advance(50);
      await expect(done).resolves.toBeUndefined();
    });

    it('regroups the survivors into the word they spell', async () => {
      const bk = create();
      const done = bk.fire('NA\nEB', {
        enter: 'none',
        exit: 'none',
        hold: 10,
        then: [{ keep: (l) => l.column === 0, exit: 'fade', as: 'line', hold: 10 }],
      });
      await Promise.resolve();
      // Past the stage boundary and its move, but before the exit.
      for (let t = 0; t < 25; t++) clock.advance(50);
      const cells = firstCell().parent?.children ?? [];
      expect(cells.filter((c) => c.visible).length).toBe(2);
      for (let t = 0; t < 60; t++) clock.advance(50);
      await done;
    });

    it('leaves an effect with no stages behaving exactly as before', async () => {
      const bk = create();
      const done = bk.fire('AB', { enter: 'none', exit: 'none', hold: 10 });
      await Promise.resolve();
      for (let t = 0; t < 30; t++) clock.advance(50);
      await expect(done).resolves.toBeUndefined();
    });
  });
```

If `firstCell()` does not expose the letter group's parent in a usable way, assert on `words()[0]` instead — the point of the second test is that two of the four letters are still visible after the regroup and two are not.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/index.test.ts -t "then"`
Expected: FAIL — TypeScript rejects `then` as an unknown property of `FireOptions`.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/index.ts`, add the public types near `FireOptions`:

```ts
/** Timing for the move into a new layout. `scale` addresses the viewport fit, not letter size. */
export interface TweenSpec {
  duration?: number;
  ease?: Easing;
  delayBy?: { position?: number; scale?: number };
}

export interface Stage {
  /** Letters that continue. The rest exit. Omitted means all of them. */
  keep?: (letter: LetterInfo) => boolean;
  /** How the letters that do not continue leave. */
  exit?: ExitSlot;
  /** Arrangement for the survivors' new layout. Omitted leaves the layout alone. */
  as?: Arrangement;
  active?: ActiveSlot;
  hold?: number | 'click';
  tween?: TweenSpec;
}
```

and to `FireOptions`:

```ts
  /**
   * Stages played after the enter, each regrouping what survives it. Advanced by the viewer when
   * a stage holds on `'click'`.
   */
  then?: Stage[];
```

Export `Arrangement`, `Stage` and `TweenSpec` from the module's type exports.

In `run()`, replace the `Timeline` construction with a `Sequence` when `opts.then` is non-empty, keeping the plain `Timeline` path otherwise so an effect with no stages is byte-for-byte the motion it is today:

```ts
    const stages = (opts.then ?? []).map((s) => ({
      keep: s.keep,
      exit: resolveSlot(s.exit ?? 'fade', EXIT),
      as: s.as,
      active: resolveSlot(s.active ?? 'none', ACTIVE),
      hold: s.hold ?? 1200,
      tween: s.tween ?? {},
    }));

    const driver = stages.length
      ? new Sequence({
          enter,
          stages,
          exit: resolveSlot(opts.exit ?? 'fade', EXIT),
          hold: untilClick ? 'click' : (hold as number),
          blendMs: opts.blendMs ?? 120,
          target: word,
        })
      : timeline;
```

Per frame, before `word.apply`:

```ts
          if (driver instanceof Sequence) driver.tick(elapsed);
          word.apply(driver, elapsed);
```

`word.apply` takes a `Timeline` today; widen its parameter to the structural type both satisfy:

```ts
  apply(source: { poseAt(elapsed: number, letter: LetterInfo, out?: Pose): Pose }, elapsed: number)
```

A held effect's dismiss handler calls `driver.release(...)` instead of `timeline.release(...)`, and it must stop being one-shot: with stages present, each click advances one stage, and only the last one ends the effect. Replace the `released` latch with a check against the driver:

```ts
        const dismiss = () => {
          driver.release(clock.now() - startedAt);
          if (driver instanceof Sequence ? driver.isFinished(clock.now() - startedAt) : true) {
            released = true;
            detachDismiss();
          }
        };
```

The finish condition becomes `driver.isFinished(since)` in both branches.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: PASS, every existing test plus the new ones.

- [ ] **Step 5: Run the full check**

Run: `npm run check`
Expected: lint clean, typecheck clean, tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "accept a stage list on fire() and play it from a sequence"
```

---


### Task 8: tint as a per-letter rule

**Files:**
- Modify: `packages/core/src/render/word.ts` (constructor signature and `buildCell`)
- Modify: `packages/core/src/index.ts` (`FireOptions.tint`)
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/word.test.ts`:

```ts
describe('tint as a function', () => {
  /** Body colour per drawn cell, in layout order. */
  function bodyColors(word: Word): number[] {
    const inner = word.group.children[0] as THREE.Group;
    return inner.children.map((cell) => {
      const mesh = (cell as THREE.Group).children[0] as THREE.Mesh;
      return (mesh.material as THREE.MeshPhysicalMaterial).color.getHex();
    });
  }

  it('colours only the letters the rule selects', () => {
    const plain = bodyColors(new Word('AB', stubFont(), 'gold', ROOMY));
    const ruled = bodyColors(
      new Word('AB', stubFont(), 'gold', ROOMY, false, (l) =>
        l.column === 0 ? 0xff0000 : undefined,
      ),
    );
    expect(ruled[0]).toBe(0xff0000);
    expect(ruled[1]).toBe(plain[1]);
  });

  it("is handed each letter's laid-out position", () => {
    const seen: LetterInfo[] = [];
    new Word('AB', stubFont(), 'gold', ROOMY, false, (l) => {
      seen.push({ ...l });
      return undefined;
    });
    expect(seen[0]?.x).toBeCloseTo(-STEP);
    expect(seen[0]?.index).toBe(0);
    expect(seen[1]?.index).toBe(1);
  });

  it('still accepts a plain number for the whole word', () => {
    const colors = bodyColors(new Word('AB', stubFont(), 'gold', ROOMY, false, 0x00ff00));
    expect(colors).toEqual([0x00ff00, 0x00ff00]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/word.test.ts -t "tint as a function"`
Expected: FAIL — TypeScript rejects a function where `tint?: number` is declared.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/render/word.ts`, widen the constructor parameter:

```ts
    tint?: number | ((letter: LetterInfo) => number | undefined),
```

and resolve it once per letter inside `buildCell`, where `letterInfo(i)` is already meaningful
because Task 1 settled the fit before any cell is built:

```ts
    const hue = typeof tint === 'function' ? tint(this.letterInfo(i)) : tint;
```

Every `applyLook(..., tintMaterialOf(spec) === 'body' ? tint : undefined)` in that method becomes
`... ? hue : undefined`, and likewise for the decoration branch. `undefined` from the rule means
the letter is not the rule's business and keeps the look's own colour.

In `packages/core/src/index.ts`, widen `FireOptions.tint` to match and extend its doc comment:

```ts
  /**
   * Recolors the look, as `0xff2d6f`. A function is consulted per letter and may return
   * `undefined` for "not mine", leaving that letter the look's own colour.
   *
   * Routed to whichever property carries that look's hue — `gem` is clear stone whose red comes
   * from what light picks up passing through it, so tinting its base color would do nothing.
   */
  tint?: number | ((letter: LetterInfo) => number | undefined);
```

`run()` passes `opts.tint` through unchanged; no other call site moves.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/src/index.ts packages/core/test/render/word.test.ts
git commit -m "let tint be a per-letter rule as well as one colour"
```

---


### Task 9: The acrostic in the lab, and the README

**Files:**
- Modify: `apps/lab/src/main.ts:344-383`
- Modify: `packages/core/README.md`

- [ ] **Step 1: Add the acrostic sequence**

In `apps/lab/src/main.ts`, add an entry to `SEQUENCES`:

```ts
  {
    name: 'acrostic',
    steps: [
      {
        text: 'NIGHT FALLS ON THE STREET\nEVERY WINDOW BURNS\nONLY THE SIGN KNOWS\nNOBODY READS IT',
        enter: 'rise',
        active: 'none',
        exit: 'recede',
        look: 'neon',
        tint: (l) => (l.column === 0 ? 0xff2d6f : undefined),
        hold: 'click',
        then: [
          { keep: (l) => l.column === 0, exit: 'fade', as: 'stack', hold: 'click' },
          { as: 'line', hold: 'click', tween: { duration: 900, delayBy: { scale: 0.45 } } },
        ],
      },
    ],
  },
```

- [ ] **Step 2: Check it by eye**

Run: `npm run dev -w @blitsklieg/lab`, open the lab, click **acrostic**, then click three times.
Expected: the poem rises; the first click fades the body text and tightens `NEON` into a vertical column; the second lays it out as a line and, a beat later, grows it to fill the viewport; the third recedes it.

Judge this by looking at it. The geometry has been correct here while the render was visibly torn.

- [ ] **Step 3: Document `then` in the README**

Add a section after **Motion**, following the table style the file already uses:

````markdown
## Stages

An effect can exit part of its word and lay the survivors out again as a word of their own.

```ts
await bk.fire(poem, {
  hold: 'click',
  then: [
    { keep: l => l.column === 0, exit: 'fade', as: 'stack', hold: 'click' },
    { as: 'line', hold: 'click' },
  ],
});
```

Each stage keeps the letters its `keep` predicate selects, plays `exit` on the rest, and lays the
survivors out again in the arrangement `as` names — `'line'` for one line, `'stack'` for one
letter per line. A stage holding on `'click'` waits for the viewer.

Survivors keep their own material, so a letter's colour travels with it. Everything else a piece
reads off `LetterInfo` — `index`, `count`, `line`, `column`, `x`, `y` — describes the new word.

`tint` takes a rule as well as a colour, which is how the letters that survive get their own one:

```ts
tint: l => (l.column === 0 ? 0xff2d6f : undefined)
```

Returning `undefined` leaves that letter the look's own colour.

`tween` times the move: `duration`, `ease`, and `delayBy` to hold a channel back. `delayBy.scale`
delays the viewport refit, so the word arrives before it resizes.
````

- [ ] **Step 4: Run the README test**

Run: `npx vitest run packages/core/test/readme.test.ts`
Expected: PASS — that suite compiles the README's examples.

- [ ] **Step 5: Full check and commit**

Run: `npm run check`
Expected: clean.

```bash
git add apps/lab/src/main.ts packages/core/README.md
git commit -m "add the acrostic to the lab and document stages"
```

---

## Notes for whoever executes this

- **Branch:** cut a fresh one off `main` after `neon-tubing` merges. Do not build this on `neon-tubing`.
- **Visual baselines:** nothing here changes an existing look, so no baseline should move. If one does, that is a regression in Task 1's refactor, not a baseline to re-record.
- **The trap:** `span` is not in this plan — it arrives with spans — but the asymmetry it creates is. Everything in `LetterInfo` is re-derived from the new group on a regroup *except* a letter's origin. When spans land, `span` must be copied across a regroup, not recomputed. `frozenInfo` is where that decision lives.
