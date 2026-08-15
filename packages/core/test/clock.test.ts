import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';

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
});
