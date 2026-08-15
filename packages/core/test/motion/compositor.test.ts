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

  it('blends both phases inside the crossfade window', () => {
    // 10ms into the 20ms window straddling the enter/active boundary at t=100.
    const x = build().poseAt(100, L).position[0];
    expect(x).toBeGreaterThan(1);
    expect(x).toBeLessThan(10);
  });

  it('never leaves a gap: some phase is always contributing', () => {
    const tl = build();
    for (let t = 0; t < tl.duration; t += 1) {
      expect(tl.poseAt(t, L).position[0], `t=${t}`).not.toBe(0);
    }
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

  const expectNoGap = (tl: Timeline) => {
    for (let t = 0; t < tl.duration; t += 1) {
      expect(tl.poseAt(t, L).position[0], `t=${t}`).not.toBe(0);
    }
  };

  it('gives a zero-length phase no weight at all', () => {
    const tl = degenerate({ enter: piece(0, 1) });
    expect(tl.duration).toBe(200);
    expect(tl.poseAt(0, L).position[0]).toBe(10);
    expectNoGap(tl);
  });

  it('covers the whole timeline when the hold is zero', () => {
    const tl = degenerate({ hold: 0 });
    expect(tl.duration).toBe(200);
    expectNoGap(tl);
  });

  it('hands over cleanly at every boundary with no blend window', () => {
    const tl = degenerate({ blendMs: 0 });
    expectNoGap(tl);
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
