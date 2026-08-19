import { describe, expect, it } from 'vitest';
import {
  type RegroupResult,
  Sequence,
  type StagePlan,
  type StageTarget,
} from '../../src/motion/sequence.js';
import type { LetterInfo, MotionPiece } from '../../src/motion/types.js';
import { NONE } from '../../src/motion/types.js';

const letter: LetterInfo = { index: 0, count: 2, x: 0, y: 0 };

const ONE_OF_TWO: RegroupResult = {
  kept: [0],
  dropped: [1],
  delta: [
    [3, 4],
    [0, 0],
  ],
};

/** A survivor's new index 1 is slot 2, and the dropped letter's old index is also 1. */
const TWO_OF_THREE: RegroupResult = {
  kept: [0, 2],
  dropped: [1],
  delta: [
    [3, 4],
    [9, 9],
    [5, 6],
  ],
};

const FLAG: MotionPiece = { duration: 200, offset: () => ({ position: [100, 0, 0] }) };

type Spy = StageTarget & { regroups: number; retired: number[][]; fit: number[] };

function target(result: RegroupResult = ONE_OF_TWO): Spy {
  const calls = {
    regroups: 0,
    retired: [] as number[][],
    fit: [] as number[],
    regroup: () => {
      calls.regroups++;
      return result;
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
      enter: { duration: 100, offset: () => ({}) },
      active: NONE,
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
      active: NONE,
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

  it('routes a dropped letter to the exit rather than to a survivor delta', () => {
    const t = target(TWO_OF_THREE);
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
      stages: [stage({ exit: FLAG })],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);

    const leaving: LetterInfo = { index: 1, count: 3, x: 0, y: 0, leaving: true };
    expect(seq.poseAt(0, leaving).position[0]).toBeCloseTo(100);

    const survivor: LetterInfo = { index: 1, count: 2, x: 0, y: 0 };
    expect(seq.poseAt(0, survivor).position[0]).toBeCloseTo(5);
  });

  it('keeps the move to its own duration when the exit is longer', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
      stages: [stage({ exit: { duration: 800, offset: () => ({}) }, tween: { duration: 200 } })],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    // The travel is done at 200ms even though the slot runs to 800ms.
    expect(seq.poseAt(200, letter).position[0]).toBeCloseTo(0);
    expect(seq.poseAt(400, letter).position[0]).toBeCloseTo(0);
  });

  it('retires the dropped letters once the move is done', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
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
      active: NONE,
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

  it('lands the fit and retires even when the move takes no time', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
      stages: [stage({ tween: { duration: 0 } })],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    expect(t.fit.at(-1)).toBe(1);
    expect(t.retired).toEqual([[1]]);
  });

  it('holds a no-time move at its landing place across a longer slot', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
      stages: [stage({ exit: { duration: 800, offset: () => ({}) }, tween: { duration: 0 } })],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    expect(seq.poseAt(0, letter).position[0]).toBeCloseTo(0);
    expect(seq.poseAt(400, letter).position[0]).toBeCloseTo(0);
  });

  it('runs the retire and the fit off the slot when the exit outlasts the move', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
      stages: [stage({ exit: { duration: 800, offset: () => ({}) }, tween: { duration: 200 } })],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    seq.tick(400);
    expect(t.retired).toEqual([]);
    expect(t.fit.at(-1)).toBeCloseTo(0.5);
    seq.tick(800);
    expect(t.retired).toEqual([[1]]);
    expect(t.fit.at(-1)).toBe(1);
  });

  it('measures the fit delay against the slot, so it can wait out a longer exit', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
      stages: [
        stage({
          exit: { duration: 800, offset: () => ({}) },
          tween: { duration: 200, delayBy: { scale: 0.5 } },
        }),
      ],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    seq.tick(400);
    expect(t.fit.at(-1)).toBeCloseTo(0);
    seq.tick(600);
    expect(t.fit.at(-1)).toBeCloseTo(0.5);
    seq.tick(800);
    expect(t.fit.at(-1)).toBe(1);
  });

  it('stops writing the fit once the stage has settled', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
      stages: [stage()],
      exit: { duration: 100, offset: () => ({}) },
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    seq.tick(400);
    const settled = t.fit.length;
    seq.tick(500);
    seq.tick(600);
    expect(t.fit.length).toBe(settled);
    expect(t.retired).toEqual([[1]]);
  });

  it('catches up across several stages in one tick', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
      stages: [stage(), stage(), stage()],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });
    seq.tick(100000);
    expect(t.regroups).toBe(3);
    expect(t.retired).toEqual([[1], [1], [1]]);
    expect(seq.isFinished(100000)).toBe(true);
  });

  it('advances one stage per release and no more', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
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

  it('plays the opening active through the opening hold', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: FLAG,
      stages: [stage()],
      exit: NONE,
      hold: 200,
      blendMs: 0,
      target: t,
    });
    seq.tick(0);
    expect(seq.poseAt(100, letter).position[0]).toBeCloseTo(100);
  });

  it('finishes after the last stage and the exit', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
      stages: [stage()],
      exit: { duration: 100, offset: () => ({}) },
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
