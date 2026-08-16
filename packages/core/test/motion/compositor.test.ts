import { describe, expect, it } from 'vitest';
import { Timeline, type TimelineOptions } from '../../src/motion/compositor.js';
import type { MotionPiece } from '../../src/motion/types.js';
import { REST } from '../../src/pose.js';

const piece = (duration: number, x: number): MotionPiece => ({
  duration,
  offset: () => ({ position: [x, 0, 0] }),
});

const build = (hold = 100) =>
  new Timeline({
    enter: piece(100, 1),
    active: piece(50, 10),
    exit: piece(100, 100),
    hold,
    blendMs: 20,
  });

const L = { index: 0, count: 1 };

/** Every phase contributes 1, so `poseAt(t).position[0]` reads back the total phase weight. */
const unit = (duration: number): MotionPiece => ({
  duration,
  offset: () => ({ position: [1, 0, 0] }),
});

const expectUnitWeight = (over: Partial<TimelineOptions> = {}) => {
  const tl = new Timeline({
    enter: unit(100),
    active: unit(50),
    exit: unit(100),
    hold: 100,
    blendMs: 20,
    ...over,
  });
  for (let t = 0; t <= tl.duration; t += 1) {
    expect(tl.poseAt(t, L).position[0], `t=${t}`).toBeCloseTo(1);
  }
};

describe('Timeline held until release', () => {
  const held = () =>
    new Timeline({
      enter: piece(100, 1),
      active: piece(50, 10),
      exit: piece(100, 100),
      hold: 'until-release',
      blendMs: 0,
    });

  it('never finishes while it is held', () => {
    const tl = held();

    expect(tl.duration).toBe(Number.POSITIVE_INFINITY);
    expect(tl.isFinished(1e9)).toBe(false);
  });

  it('keeps looping the active phase while held', () => {
    expect(held().poseAt(1e6, L).position[0]).toBe(10);
  });

  it('runs the exit once released', () => {
    const tl = held();
    tl.release(500);

    expect(tl.duration).toBe(600);
    expect(tl.isFinished(599)).toBe(false);
    expect(tl.isFinished(600)).toBe(true);
    expect(tl.poseAt(550, L).position[0]).toBe(100);
  });

  it('ignores a second release, so a double click cannot cut the exit short', () => {
    const tl = held();
    tl.release(500);
    tl.release(900);

    expect(tl.duration).toBe(600);
  });

  it('still plays a whole exit when released before the enter has finished', () => {
    const tl = held();
    tl.release(10);

    expect(tl.duration).toBe(200);
  });

  it('leaves a numeric hold alone', () => {
    const tl = build(100);
    tl.release(10);

    expect(tl.duration).toBe(300);
  });
});

describe('Timeline', () => {
  it('reports total duration as enter + hold + exit', () => {
    expect(build(100).duration).toBe(300);
  });

  it('is finished only past the end', () => {
    const tl = build();
    expect(tl.isFinished(299)).toBe(false);
    expect(tl.isFinished(300)).toBe(true);
  });

  it('applies only enter in the middle of the enter phase', () => {
    expect(build().poseAt(50, L).position[0]).toBe(1);
  });

  it('applies only active in the middle of the hold', () => {
    expect(build().poseAt(150, L).position[0]).toBe(10);
  });

  it('blends both phases evenly at the midpoint of the crossfade window', () => {
    // Halfway through the 20ms window straddling the enter/active boundary at t=100:
    // 0.5 of enter's 1, plus 0.5 of active's 10 sampled at its loop start.
    expect(build().poseAt(100, L).position[0]).toBeCloseTo(5.5);
  });

  it('holds total phase weight at 1 for the whole timeline', () => {
    expectUnitWeight();
  });

  it('loops the active piece rather than running it once', () => {
    const tl = build(200);
    // active duration is 50ms, so 120ms and 170ms into the hold are the same phase point
    expect(tl.poseAt(220, L)).toEqual(tl.poseAt(270, L));
  });

  it('samples the looping active piece at its wrapped phase point', () => {
    const tl = new Timeline({
      enter: piece(100, 1),
      active: { duration: 50, offset: (t) => ({ position: [t, 0, 0] }) },
      exit: piece(100, 100),
      hold: 200,
      blendMs: 20,
    });
    expect(tl.poseAt(160, L).position[0]).toBe(0.2);
    expect(tl.poseAt(210, L).position[0]).toBe(0.2);
    expect(tl.poseAt(185, L).position[0]).toBe(0.7);
  });
});

describe('Timeline with degenerate durations', () => {
  const degenerate = (over: Partial<TimelineOptions>) =>
    new Timeline({
      enter: piece(100, 1),
      active: piece(50, 10),
      exit: piece(100, 100),
      hold: 100,
      blendMs: 20,
      ...over,
    });

  it('gives a zero-length phase no weight at all', () => {
    const tl = degenerate({ enter: piece(0, 1) });
    expect(tl.duration).toBe(200);
    expect(tl.poseAt(0, L).position[0]).toBe(10);
    expectUnitWeight({ enter: unit(0) });
  });

  it('covers the whole timeline when the hold is zero', () => {
    const tl = degenerate({ hold: 0 });
    expect(tl.duration).toBe(200);
    expectUnitWeight({ hold: 0 });
  });

  it('does not overshoot when the hold is shorter than the blend window', () => {
    expectUnitWeight({ hold: 10 });
  });

  it('hands over cleanly at every boundary with no blend window', () => {
    const tl = degenerate({ blendMs: 0 });
    expectUnitWeight({ blendMs: 0 });
    expect(tl.poseAt(99, L).position[0]).toBe(1);
    expect(tl.poseAt(100, L).position[0]).toBe(10);
    expect(tl.poseAt(199, L).position[0]).toBe(10);
    expect(tl.poseAt(200, L).position[0]).toBe(100);
  });

  it('is finished immediately when every phase is empty', () => {
    const tl = degenerate({
      enter: piece(0, 1),
      active: piece(0, 10),
      exit: piece(0, 100),
      hold: 0,
    });
    expect(tl.duration).toBe(0);
    expect(tl.isFinished(0)).toBe(true);
    expect(tl.poseAt(0, L)).toEqual(REST);
  });
});
