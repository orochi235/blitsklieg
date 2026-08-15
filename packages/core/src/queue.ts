export type QueuePolicy = 'queue' | 'replace' | 'concurrent';
export type EffectRunner = (signal: AbortSignal) => Promise<void>;

interface Entry {
  id: string;
  run: EffectRunner;
  resolve: () => void;
  reject: (e: unknown) => void;
}

interface Slot {
  id: string;
  controller: AbortController;
  settled: Promise<void>;
}

/**
 * Under `replace` the newest push wins outright: it aborts the running effect and drops any
 * effect still waiting, since a `replace` that keeps a backlog is `queue` with an extra abort.
 *
 * Dropping a queued effect resolves rather than rejects — it is done, not failed. A running
 * effect settles however its runner settles, so an abort can still surface as a rejection.
 */
export class EffectQueue {
  private pending: Entry[] = [];
  private live = new Set<Slot>();
  private draining = false;

  constructor(private readonly policy: QueuePolicy = 'queue') {}

  /** The most recently started effect that has not finished; only `concurrent` has more than one. */
  get current(): string | null {
    let latest: string | null = null;
    for (const slot of this.live) latest = slot.id;
    return latest;
  }

  push(id: string, run: EffectRunner): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry: Entry = { id, run, resolve, reject };

      if (this.policy === 'concurrent') {
        void this.start(entry);
        return;
      }
      if (this.policy === 'replace') {
        this.abortLive();
        this.dropPending();
      }

      this.pending.push(entry);
      // Guarding on `live` instead would start a second drain when an effect settles
      // and its own completion handler pushes, running two effects at once.
      if (!this.draining) void this.drain();
    });
  }

  /** Resolves once every aborted effect has finished tearing down, so callers can free what they share. */
  async cancelAll(): Promise<void> {
    this.abortLive();
    this.dropPending();
    await Promise.allSettled([...this.live].map((slot) => slot.settled));
  }

  private abortLive(): void {
    for (const slot of this.live) slot.controller.abort();
  }

  private dropPending(): void {
    const dropped = this.pending;
    this.pending = [];
    for (const entry of dropped) entry.resolve();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      for (let entry = this.pending.shift(); entry; entry = this.pending.shift()) {
        await this.start(entry);
      }
    } finally {
      this.draining = false;
    }
  }

  private start(entry: Entry): Promise<void> {
    const slot: Slot = {
      id: entry.id,
      controller: new AbortController(),
      settled: Promise.resolve(),
    };
    this.live.add(slot);
    // A runner that calls cancelAll from its own synchronous prologue observes the placeholder
    // and is not waited for. Unreachable while every runner awaits something first.
    slot.settled = this.execute(entry, slot);
    return slot.settled;
  }

  private async execute(entry: Entry, slot: Slot): Promise<void> {
    try {
      await entry.run(slot.controller.signal);
      entry.resolve();
    } catch (e) {
      entry.reject(e);
    } finally {
      this.live.delete(slot);
    }
  }
}
