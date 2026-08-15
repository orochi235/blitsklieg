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
}

/**
 * Cancellation resolves rather than rejects: a cancelled effect is done, not failed,
 * and callers commonly `await` a fire-and-forget effect that `destroy()` will cut short.
 */
export class EffectQueue {
  private pending: Entry[] = [];
  private live = new Set<Slot>();
  private draining = false;

  constructor(private policy: QueuePolicy = 'queue') {}

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
        void this.execute(entry);
        return;
      }
      if (this.policy === 'replace') this.abortLive();

      this.pending.push(entry);
      // Guarding on `live` instead would start a second drain when an effect settles
      // and its own completion handler pushes, running two effects at once.
      if (!this.draining) void this.drain();
    });
  }

  cancelAll(): void {
    this.abortLive();
    const dropped = this.pending;
    this.pending = [];
    for (const entry of dropped) entry.resolve();
  }

  private abortLive(): void {
    for (const slot of this.live) slot.controller.abort();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const entry = this.pending.shift() as Entry;
        await this.execute(entry);
      }
    } finally {
      this.draining = false;
    }
  }

  private async execute(entry: Entry): Promise<void> {
    const slot: Slot = { id: entry.id, controller: new AbortController() };
    this.live.add(slot);

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
