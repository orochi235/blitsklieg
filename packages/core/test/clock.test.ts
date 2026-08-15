import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualClock, RafClock } from '../src/clock.js';

describe('ManualClock', () => {
  it('starts at zero', () => {
    expect(new ManualClock().now()).toBe(0);
  });

  it('advances by the given delta', () => {
    const c = new ManualClock();
    c.advance(16);
    c.advance(16);
    expect(c.now()).toBe(32);
  });

  it('runs subscribed callbacks once per advance, with the current time', () => {
    const c = new ManualClock();
    const seen: number[] = [];
    c.subscribe((t) => seen.push(t));
    c.advance(10);
    c.advance(5);
    expect(seen).toEqual([10, 15]);
  });

  it('stops calling a callback after unsubscribe', () => {
    const c = new ManualClock();
    const seen: number[] = [];
    const off = c.subscribe((t) => seen.push(t));
    c.advance(10);
    off();
    c.advance(10);
    expect(seen).toEqual([10]);
  });

  it('notifies every subscriber on each advance', () => {
    const c = new ManualClock();
    const seenA: number[] = [];
    const seenB: number[] = [];
    c.subscribe((t) => seenA.push(t));
    c.subscribe((t) => seenB.push(t));
    c.advance(10);
    c.advance(5);
    expect(seenA).toEqual([10, 15]);
    expect(seenB).toEqual([10, 15]);
  });

  it('does not call a peer that was unsubscribed earlier in the same tick', () => {
    const c = new ManualClock();
    const seenB: number[] = [];
    let offB: () => void = () => {};
    c.subscribe(() => offB()); // runs first, unsubscribes B before B runs
    offB = c.subscribe((t) => seenB.push(t)); // runs second
    c.advance(10);
    expect(seenB).toEqual([]);
  });
});

interface FakeRaf {
  pump: (t: number) => void;
  pendingCount: () => number;
}

function installFakeRaf(): FakeRaf {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    callbacks.delete(id);
  });
  return {
    pump: (t: number) => {
      const entries = [...callbacks.entries()];
      callbacks.clear();
      for (const [, cb] of entries) cb(t);
    },
    pendingCount: () => callbacks.size,
  };
}

describe('RafClock', () => {
  let currentTime = 0;
  let raf: FakeRaf;

  beforeEach(() => {
    currentTime = 0;
    raf = installFakeRaf();
    vi.spyOn(performance, 'now').mockImplementation(() => currentTime);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('now() is live: elapsed from a pre-subscribe sample to the first tick stays near a frame, not page-relative', () => {
    currentTime = 412337.2; // clock constructed long after page navigation start
    const c = new RafClock();
    const startedAt = c.now();

    let tickNow: number | undefined;
    c.subscribe((t) => {
      tickNow = t;
    });
    raf.pump(412353.9); // raw, page-relative rAF timestamp

    expect(tickNow).toBeDefined();
    const elapsed = (tickNow as number) - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(100);
  });

  it('a second subscribe cycle after a long idle gap also starts near zero relative to its own sampled start', () => {
    currentTime = 1000;
    const c = new RafClock();

    const offA = c.subscribe(() => {});
    raf.pump(1016.7);
    offA();

    currentTime = 50000; // long idle gap between cycles

    const startedAt2 = c.now();
    let seenB: number | undefined;
    c.subscribe((t) => {
      seenB = t;
    });
    raf.pump(50016.7);

    expect(seenB).toBeDefined();
    const elapsed2 = (seenB as number) - startedAt2;
    expect(elapsed2).toBeGreaterThanOrEqual(0);
    expect(elapsed2).toBeLessThan(100);
  });

  it('a throwing subscriber does not block peers and does not stop subsequent frames', () => {
    const deferred: Array<() => void> = [];
    vi.stubGlobal('queueMicrotask', (cb: () => void) => {
      deferred.push(cb);
    });

    const c = new RafClock();
    const seen: number[] = [];
    c.subscribe(() => {
      throw new Error('boom');
    });
    c.subscribe((t) => seen.push(t));

    expect(() => raf.pump(16.7)).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(deferred).toHaveLength(1);
    expect(() => deferred[0]?.()).toThrow('boom');

    raf.pump(33.4);
    expect(seen).toHaveLength(2);
  });

  it('unsubscribing the last subscriber from inside a tick leaves no pending frame scheduled', () => {
    let off: () => void = () => {};
    off = new RafClock().subscribe(() => off());

    raf.pump(16.7);

    expect(raf.pendingCount()).toBe(0);
  });

  it('does not call a peer unsubscribed earlier in the same tick', () => {
    const c = new RafClock();
    const seenB: number[] = [];
    let offB: () => void = () => {};
    c.subscribe(() => offB()); // runs first, unsubscribes B before B runs
    offB = c.subscribe((t) => seenB.push(t)); // runs second

    raf.pump(16.7);

    expect(seenB).toEqual([]);
  });
});
