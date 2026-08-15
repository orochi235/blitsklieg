export type Tick = (nowMs: number) => void;
export type Unsubscribe = () => void;

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
    for (const fn of [...this.subs]) fn(this.t);
  }
}

export class RafClock implements Clock {
  private subs = new Set<Tick>();
  private raf: number | null = null;
  private t = 0;

  now(): number {
    return this.t;
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
      this.t = t;
      for (const fn of [...this.subs]) fn(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}
