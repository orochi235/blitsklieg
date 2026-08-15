import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion, Stage, webglSupported } from '../../src/render/stage.js';

/** No DOM here, so every test stays on the paths that never touch `target`. */
function headlessStage(idleTimeoutMs = 1000): Stage {
  return new Stage({ idleTimeoutMs });
}

function frustumHeight(stage: Stage): number {
  return 2 * Math.tan((stage.camera.fov * Math.PI) / 360) * stage.camera.position.z;
}

describe('viewportBudget', () => {
  // 2 * tan(38deg / 2) * 11 = 7.5752075 visible units tall at the word's depth.
  it('matches an extent computed by hand from the constructor fov and distance', () => {
    const stage = headlessStage();

    expect(stage.viewportBudget(1, 1).height).toBeCloseTo(7.5752075, 6);
    expect(stage.viewportBudget().width).toBeCloseTo(4.6966286, 6);
    expect(stage.viewportBudget().height).toBeCloseTo(2.2725622, 6);
  });

  it('matches the frustum extent at the camera distance', () => {
    const stage = headlessStage();
    stage.camera.aspect = 1.5;
    const budget = stage.viewportBudget(1, 1);

    expect(budget.height).toBeCloseTo(frustumHeight(stage), 12);
    expect(budget.width).toBeCloseTo(frustumHeight(stage) * 1.5, 12);
  });

  it('leaves room by default rather than filling the frustum', () => {
    const stage = headlessStage();
    const budget = stage.viewportBudget();

    expect(budget.width).toBeCloseTo(frustumHeight(stage) * stage.camera.aspect * 0.62, 12);
    expect(budget.height).toBeCloseTo(frustumHeight(stage) * 0.3, 12);
  });

  it('feeds aspect into width only', () => {
    const stage = headlessStage();
    stage.camera.aspect = 1;
    const square = stage.viewportBudget();
    stage.camera.aspect = 2;
    const wide = stage.viewportBudget();

    expect(wide.width).toBeCloseTo(square.width * 2, 12);
    expect(wide.height).toBeCloseTo(square.height, 12);
  });

  it('scales linearly with the fractions and with camera distance', () => {
    const stage = headlessStage();
    const half = stage.viewportBudget(0.31, 0.15);
    const full = stage.viewportBudget(0.62, 0.3);

    expect(half.width).toBeCloseTo(full.width / 2, 12);
    expect(half.height).toBeCloseTo(full.height / 2, 12);

    stage.camera.position.z *= 3;
    const far = stage.viewportBudget();
    expect(far.width).toBeCloseTo(full.width * 3, 12);
    expect(far.height).toBeCloseTo(full.height * 3, 12);
  });
});

describe('idle teardown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('unmounts once the idle timeout elapses', () => {
    vi.useFakeTimers();
    const stage = headlessStage(500);
    const unmount = vi.spyOn(stage, 'unmount');

    stage.scheduleIdleTeardown();
    vi.advanceTimersByTime(499);
    expect(unmount).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown instead of stacking timers', () => {
    vi.useFakeTimers();
    const stage = headlessStage(500);
    const unmount = vi.spyOn(stage, 'unmount');

    stage.scheduleIdleTeardown();
    vi.advanceTimersByTime(400);
    stage.scheduleIdleTeardown();
    vi.advanceTimersByTime(400);
    expect(unmount).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(unmount).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending teardown when unmounted early', () => {
    vi.useFakeTimers();
    const stage = headlessStage(500);
    const unmount = vi.spyOn(stage, 'unmount');

    stage.scheduleIdleTeardown();
    stage.unmount();
    vi.advanceTimersByTime(10_000);
    expect(unmount).toHaveBeenCalledTimes(1);
  });
});

describe('unmount', () => {
  it('is safe on a stage that was never mounted, and repeatable', () => {
    const stage = headlessStage();
    expect(() => {
      stage.unmount();
      stage.unmount();
    }).not.toThrow();

    expect(stage.canvas).toBeNull();
    expect(stage.renderer).toBeNull();
    expect(stage.environment).toBeNull();
    expect(stage.scene.environment).toBeNull();
  });

  it('detaches the canvas even when disposal throws, so no context is stranded', () => {
    const stage = headlessStage();
    const remove = vi.fn();
    stage.canvas = { remove } as unknown as HTMLCanvasElement;
    stage.environment = {
      dispose: () => {
        throw new Error('dispose failed');
      },
    } as unknown as THREE.WebGLRenderTarget;

    expect(() => stage.unmount()).toThrow('dispose failed');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(stage.canvas).toBeNull();
    expect(stage.environment).toBeNull();
  });
});

describe('resize', () => {
  it('does nothing without a renderer, so no NaN aspect reaches the camera', () => {
    const stage = headlessStage();
    expect(() => stage.resize()).not.toThrow();
    expect(stage.camera.aspect).toBe(1);
  });
});

describe('webglSupported', () => {
  it('reports false rather than throwing where there is no document', () => {
    expect(webglSupported()).toBe(false);
  });
});

describe('prefersReducedMotion', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'matchMedia');
  });

  it('is false where matchMedia is unavailable', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('asks for the reduce query and returns its match', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    Object.defineProperty(globalThis, 'matchMedia', { value: matchMedia, configurable: true });

    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');

    matchMedia.mockReturnValue({ matches: false });
    expect(prefersReducedMotion()).toBe(false);
  });
});
