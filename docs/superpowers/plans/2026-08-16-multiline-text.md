# Multiline Text and Indefinite Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** render text on more than one line, and hold an effect on screen until the user dismisses it.

**Architecture:** `layoutBlock` splits text into lines and `wrapBlock` picks line breaks by maximizing `fitScale`. `Word` gains a `baseY` per letter, mirroring the `baseX` that pose offsets already add onto. `Timeline` gains `release()` so the active phase can end on an event rather than a timer.

**Tech Stack:** TypeScript 7, three.js 0.185, vitest 4, Playwright, Biome 2.

**Reference:** `docs/superpowers/specs/2026-08-16-multiline-text-design.md`

---

### Task 1: layoutBlock

**Files:**
- Modify: `packages/core/src/text/layout.ts`
- Test: `packages/core/test/text/layout.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/text/layout.test.ts`:

```ts
describe('layoutBlock', () => {
  it('returns one line when there is no newline', () => {
    const block = layoutBlock('AB', metrics);
    expect(block.lines).toHaveLength(1);
    expect(block.lines[0]?.width).toBe(20);
  });

  it('splits on newlines', () => {
    const block = layoutBlock('AB\nC', metrics);
    expect(block.lines.map((l) => l.glyphs.map((g) => g.char).join(''))).toEqual(['AB', 'C']);
  });

  it('splits on CRLF as well', () => {
    expect(layoutBlock('A\r\nB', metrics).lines).toHaveLength(2);
  });

  it('width is the widest line', () => {
    expect(layoutBlock('ABC\nA', metrics).width).toBe(30);
  });

  it('keeps a blank line as an empty line rather than dropping it', () => {
    const block = layoutBlock('A\n\nB', metrics);
    expect(block.lines).toHaveLength(3);
    expect(block.lines[1]?.glyphs).toEqual([]);
  });

  it('never asks the font about the newline character', () => {
    const strict = {
      advanceOf: (ch: string) => {
        if (ch === '\n' || ch === '\r') throw new Error(`newline reached the font: ${escape(ch)}`);
        return 10;
      },
      kernOf: () => 0,
    };
    expect(() => layoutBlock('A\nB', strict)).not.toThrow();
  });

  it('an empty string is a single empty line', () => {
    expect(layoutBlock('', metrics).lines).toHaveLength(1);
  });
});
```

Add `layoutBlock` to the import on line 2.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/test/text/layout.test.ts`
Expected: FAIL — `layoutBlock is not a function`.

- [ ] **Step 3: Implement**

Append to `packages/core/src/text/layout.ts`:

```ts
/** Leading between baselines. Display capitals want less than the 1.2 that suits body text. */
export const LINE_HEIGHT_EM = 1.1;

export interface Block {
  lines: Line[];
  /** Widest line, in font units. */
  width: number;
}

/** Splits on newlines and lays out each line. The separator is consumed, never laid out. */
export function layoutBlock(text: string, metrics: GlyphMetrics): Block {
  const lines = text.split(/\r?\n/).map((seg) => layoutLine(seg, metrics));
  return { lines, width: Math.max(0, ...lines.map((l) => l.width)) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/test/text/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/layout.ts packages/core/test/text/layout.test.ts
git commit -m "lay text out as a block of lines"
```

---

### Task 2: wrapBlock

**Files:**
- Modify: `packages/core/src/text/layout.ts`
- Test: `packages/core/test/text/layout.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('wrapBlock', () => {
  const UPEM = 1000;
  // Budget wide enough for ~2 glyphs per line, tall enough for several lines.
  const tight = { width: 25, height: 100 };

  it('keeps one line when the budget is roomy', () => {
    expect(wrapBlock('A B', metrics, { width: 1000, height: 1000 }, UPEM).lines).toHaveLength(1);
  });

  it('breaks at word boundaries when that makes the text bigger', () => {
    const block = wrapBlock('AA BB CC', metrics, tight, UPEM);
    expect(block.lines.length).toBeGreaterThan(1);
    for (const line of block.lines) expect(line.width).toBeLessThanOrEqual(25);
  });

  it('never splits a single word', () => {
    const block = wrapBlock('AAAAAA', metrics, tight, UPEM);
    expect(block.lines).toHaveLength(1);
  });

  it('honors explicit newlines and wraps under them', () => {
    const block = wrapBlock('A\nBB CC', metrics, tight, UPEM);
    expect(block.lines.length).toBeGreaterThanOrEqual(2);
    expect(block.lines[0]?.glyphs.map((g) => g.char).join('')).toBe('A');
  });

  it('picks the same arrangement whatever the units per em', () => {
    const at1000 = wrapBlock('AA BB CC', metrics, tight, 1000);
    const scaled = { advanceOf: (ch: string) => (ch === ' ' ? 10.24 : 20.48), kernOf: () => 0 };
    const at2048 = wrapBlock('AA BB CC', scaled, { width: 51.2, height: 204.8 }, 2048);
    expect(at2048.lines.map((l) => l.glyphs.length)).toEqual(
      at1000.lines.map((l) => l.glyphs.length),
    );
  });

  it('collapses runs of whitespace', () => {
    const block = wrapBlock('A   B', metrics, { width: 1000, height: 1000 }, UPEM);
    expect(block.lines[0]?.glyphs.map((g) => g.char).join('')).toBe('A B');
  });

  it('an empty string is a single empty line', () => {
    expect(wrapBlock('', metrics, tight, UPEM).lines).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/test/text/layout.test.ts`
Expected: FAIL — `wrapBlock is not a function`.

- [ ] **Step 3: Implement**

Append to `packages/core/src/text/layout.ts`:

```ts
/**
 * Chooses line breaks maximizing `fitScale`. Searches one candidate maximum line width rather
 * than line counts, which keeps explicit newline segments from making the search combinatorial.
 * `unitsPerEm` converts the em-denominated leading into the font units line widths arrive in;
 * comparing the two unconverted silently prefers the tallest arrangement.
 */
export function wrapBlock(
  text: string,
  metrics: GlyphMetrics,
  budget: Budget,
  unitsPerEm: number,
): Block {
  const segments = text.split(/\r?\n/).map((seg) => seg.trim().split(/\s+/).filter(Boolean));

  // Kerning makes width non-additive, so a run of words is measured whole rather than summed.
  const measurers = segments.map((words) => {
    const memo = new Map<string, number>();
    return (i: number, j: number): number => {
      if (j < i) return 0;
      const key = `${i}:${j}`;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      const w = layoutLine(words.slice(i, j + 1).join(' '), metrics).width;
      memo.set(key, w);
      return w;
    };
  });

  const candidates = new Set<number>();
  segments.forEach((words, s) => {
    const measure = measurers[s] as (i: number, j: number) => number;
    for (let i = 0; i < words.length; i++) {
      for (let j = i; j < words.length; j++) candidates.add(measure(i, j));
    }
  });
  if (candidates.size === 0) return layoutBlock(text, metrics);

  let best: { text: string[]; scale: number; width: number } | null = null;

  for (const limit of candidates) {
    const lines: string[] = [];
    let widest = 0;

    for (let s = 0; s < segments.length; s++) {
      const words = segments[s] as string[];
      const measure = measurers[s] as (i: number, j: number) => number;
      let start = 0;
      for (let i = 1; i < words.length; i++) {
        if (measure(start, i) > limit) {
          lines.push(words.slice(start, i).join(' '));
          widest = Math.max(widest, measure(start, i - 1));
          start = i;
        }
      }
      lines.push(words.slice(start).join(' '));
      widest = Math.max(widest, measure(start, words.length - 1));
    }

    const scale = fitScale(widest, lines.length * LINE_HEIGHT_EM * unitsPerEm, budget);
    const better =
      !best ||
      scale > best.scale ||
      (scale === best.scale &&
        (lines.length < best.text.length ||
          (lines.length === best.text.length && widest < best.width)));
    if (better) best = { text: lines, scale, width: widest };
  }

  const chosen = (best as { text: string[] }).text;
  const lines = chosen.map((line) => layoutLine(line, metrics));
  return { lines, width: Math.max(0, ...lines.map((l) => l.width)) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/test/text/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/layout.ts packages/core/test/text/layout.test.ts
git commit -m "wrap text to the arrangement that renders largest"
```

---

### Task 3: LetterInfo gains block position

**Files:**
- Modify: `packages/core/src/motion/types.ts:3-8`

Fields are optional because nothing reads them yet; the motion authoring plan tightens them to
required when grid-aware stagger consumes them, alongside the test churn that implies.

- [ ] **Step 1: Implement**

```ts
export interface LetterInfo {
  /** 0-based position in the word, whitespace included. */
  index: number;
  /** Total letters in the word. */
  count: number;
  /** 0-based line within the block. */
  line?: number;
  /** 0-based column within its own line. */
  column?: number;
  lineCount?: number;
  /** The widest line's length, so a short line's columns do not stretch to fill it. */
  columnCount?: number;
}
```

- [ ] **Step 2: Verify nothing broke**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/motion/types.ts
git commit -m "carry a letter's block position on LetterInfo"
```

---

### Task 4: Word renders a block

**Files:**
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('Word multiline', () => {
  it('gives every line its own row of letters', () => {
    const word = new Word('AB\nCD', stubFont(), 'gold', ROOMY);
    expect(word.letterCount).toBe(4);
    expect(meshes(word)).toHaveLength(4);
  });

  it('drops each line below the one above it', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    const [first, second] = meshes(word) as THREE.Mesh[];
    expect((second as THREE.Mesh).position.y).toBeLessThan((first as THREE.Mesh).position.y);
  });

  it('centers each line independently', () => {
    const word = new Word('AA\nB', stubFont(), 'gold', ROOMY);
    const [a1, a2, b] = meshes(word) as THREE.Mesh[];
    const rowCenter = ((a1 as THREE.Mesh).position.x + (a2 as THREE.Mesh).position.x) / 2;
    expect((b as THREE.Mesh).position.x).toBeCloseTo(rowCenter, 5);
  });

  it('adds pose y onto the line baseline instead of replacing it', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    const timeline = timelineOf((): PoseOffset => ({ position: [0, 1, 0] }));
    const before = meshes(word).map((m) => m.position.y);

    word.apply(timeline, 0);

    const after = meshes(word).map((m) => m.position.y);
    expect(after[0[0] as number]).toBeCloseTo((before[0] as number) + 1, 5);
    expect(after[1] as number).toBeCloseTo((before[1] as number) + 1, 5);
    expect(after[0] as number).not.toBeCloseTo(after[1] as number, 5);
  });

  it('reports each letter its position in the block', () => {
    const word = new Word('AB\nC', stubFont(), 'gold', ROOMY);
    const seen: LetterInfo[] = [];
    const timeline = timelineOf((_t, letter): PoseOffset => {
      seen.push(letter);
      return {};
    });

    word.apply(timeline, 0);

    expect(seen.map((l) => l.line)).toEqual([0, 0, 1]);
    expect(seen.map((l) => l.column)).toEqual([0, 1, 0]);
    expect(seen[0]?.lineCount).toBe(2);
    expect(seen[0]?.columnCount).toBe(2);
  });

  it('wraps when asked and leaves the text alone when not', () => {
    const narrow: Budget = { width: 1.2, height: 100 };
    expect(new Word('AA BB', stubFont(), 'gold', narrow, true).lineCount).toBeGreaterThan(1);
    expect(new Word('AA BB', stubFont(), 'gold', narrow, false).lineCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: FAIL — no `lineCount`, letters stacked at one y.

- [ ] **Step 3: Implement**

Replace the constructor body and `apply` in `packages/core/src/render/word.ts` per the spec:
carry `baseY`, `lineOf`, `columnOf`; lay out with `wrapBlock` when `wrap`, `layoutBlock`
otherwise; center each line on x within the block; fit over the block's ink bounds.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "render a word as a block of centered lines"
```

---

### Task 5: Timeline release

**Files:**
- Modify: `packages/core/src/motion/compositor.ts`
- Test: `packages/core/test/motion/compositor.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('Timeline held until release', () => {
  const held = () =>
    new Timeline({
      enter: { duration: 100, offset: () => ({}) },
      active: { duration: 100, offset: () => ({}) },
      exit: { duration: 100, offset: () => ({}) },
      hold: 'until-release',
      blendMs: 0,
    });

  it('never finishes while held', () => {
    const t = held();
    expect(t.duration).toBe(Number.POSITIVE_INFINITY);
    expect(t.isFinished(1e9)).toBe(false);
  });

  it('runs the exit after release', () => {
    const t = held();
    t.release(500);
    expect(t.duration).toBe(600);
    expect(t.isFinished(599)).toBe(false);
    expect(t.isFinished(600)).toBe(true);
  });

  it('ignores a second release', () => {
    const t = held();
    t.release(500);
    t.release(900);
    expect(t.duration).toBe(600);
  });

  it('releasing before the enter finishes still plays a full exit', () => {
    const t = held();
    t.release(10);
    expect(t.duration).toBeGreaterThanOrEqual(110);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/test/motion/compositor.test.ts`
Expected: FAIL — `hold` rejects `'until-release'`.

- [ ] **Step 3: Implement**

`TimelineOptions.hold` becomes `number | 'until-release'`. Hold `Infinity` while unreleased;
`release(elapsed)` fixes the active end at `max(elapsed, enterEnd)` and rebuilds the segments.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/test/motion/compositor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/motion/compositor.ts packages/core/test/motion/compositor.test.ts
git commit -m "hold a timeline open until it is released"
```

---

### Task 6: fire() options and dismissal

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/render/stage.ts`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Implement `Stage.setInteractive`**

```ts
/** Modal hold is the one state where the overlay is not click-through. */
setInteractive(on: boolean): void {
  if (this.canvas) this.canvas.style.pointerEvents = on ? 'auto' : 'none';
}
```

- [ ] **Step 2: Widen FireOptions**

```ts
hold?: number | 'click';
wrap?: boolean;
modal?: boolean;
```

- [ ] **Step 3: Wire dismissal in `run()`**

Attach on `pointerdown` (capture, passive) and `keydown` for Escape; call `timeline.release(since)`.
`modal` calls `stage.setInteractive(true)` and listens on the canvas. Detach and restore inside
`settle()`. The reduced-motion branch waits on release rather than `since >= hold`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/render/stage.ts packages/core/test/index.test.ts
git commit -m "hold an effect until the viewer dismisses it"
```

---

### Task 7: Lab

**Files:**
- Modify: `apps/lab/index.html`
- Modify: `apps/lab/src/main.ts`

- [ ] **Step 1: Swap the input for a textarea and add the checkboxes**

`<textarea id="text" rows="2">`, plus `wrap`, `holdClick` and `modal` checkboxes.

- [ ] **Step 2: Rebind Enter**

```ts
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    fireCurrent();
  }
});
```

- [ ] **Step 3: Pass the new options through `fire()`**

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/lab
git commit -m "drive multiline and held effects from the lab"
```

---

## Notes

`Stage.viewportBudget` uses `heightFrac = 0.3`, which bounds a block to roughly two or three
lines before height binds and the argmax stops preferring more of them. That is a deliberate
consequence of the budget, not a wrap bug — klieg renders banners, not paragraphs. Raising
it would rescale every existing single-line effect.
