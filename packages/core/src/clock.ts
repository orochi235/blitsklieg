export type Tick = (nowMs: number) => void;
export type Unsubscribe = () => void;

/**
 * `now()` and tick timestamps share one live, monotonic timeline starting near 0.
 * `now()` is valid before, during, and after any subscription — consumers capture a
 * start time with `now()` and difference it against ticks.
 *
 * A subscriber that throws is isolated in `RafClock` so it cannot stop the frame loop;
 * `ManualClock` deliberately lets it propagate so tests see failures.
 */
export interface Clock {
  now(): number;
  subscribe(fn: Tick): Unsubscribe;
}

export class ManualClock implements Clock {
  private t = 0;
  private subs = new Set<Tick>();

  now(): number {
    return this.t;
  }

  subscribe(fn: Tick): Unsubscribe {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  advance(deltaMs: number): void {
    this.t += deltaMs;
    for (const fn of [...this.subs]) {
      if (!this.subs.has(fn)) continue;
      fn(this.t);
    }
  }
}

export class RafClock implements Clock {
  private subs = new Set<Tick>();
  private raf: number | null = null;
  private readonly origin = performance.now();

  now(): number {
    return performance.now() - this.origin;
  }

  subscribe(fn: Tick): Unsubscribe {
    this.subs.add(fn);
    if (this.raf === null) this.start();
    return () => {
      this.subs.delete(fn);
      if (this.subs.size === 0) this.stop();
    };
  }

  private start(): void {
    const loop = (t: number) => {
      // Reschedule FIRST: a throwing subscriber must not be able to kill the loop.
      this.raf = requestAnimationFrame(loop);
      const now = Math.max(0, t - this.origin);
      for (const fn of [...this.subs]) {
        if (!this.subs.has(fn)) continue; // unsubscribed earlier in this same tick
        try {
          fn(now);
        } catch (err) {
          queueMicrotask(() => {
            throw err;
          });
        }
      }
      // A subscriber may have unsubscribed itself above, after start() was decided.
      if (this.subs.size === 0) this.stop();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}
