import { describe, expect, it, vi } from 'vitest';
import { EffectQueue } from '../src/queue.js';

describe('EffectQueue', () => {
  it('runs one effect at a time and reports what is current', async () => {
    const q = new EffectQueue('queue');
    const order: string[] = [];
    const a = q.push('a', async () => {
      order.push('a');
    });
    const b = q.push('b', async () => {
      order.push('b');
    });
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
    expect(q.current).toBeNull();
  });

  it('replace policy cancels the running effect', async () => {
    const q = new EffectQueue('replace');
    const cancelled = vi.fn();
    const a = q.push('a', (signal) => {
      signal.addEventListener('abort', cancelled);
      return new Promise<void>((r) => setTimeout(r, 50));
    });
    await Promise.resolve();
    const b = q.push('b', async () => {});
    await Promise.all([a, b]);
    expect(cancelled).toHaveBeenCalled();
  });

  it('concurrent policy runs effects simultaneously', async () => {
    const q = new EffectQueue('concurrent');
    let peak = 0;
    let live = 0;
    const run = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 10));
      live--;
    };
    await Promise.all([q.push('a', run), q.push('b', run)]);
    expect(peak).toBe(2);
  });

  it('a rejecting effect does not stall the queue', async () => {
    const q = new EffectQueue('queue');
    const failed = q.push('bad', async () => {
      throw new Error('boom');
    });
    await expect(failed).rejects.toThrow('boom');
    await expect(q.push('good', async () => {})).resolves.toBeUndefined();
  });

  it('stays serial when a completion handler pushes two more effects', async () => {
    const q = new EffectQueue('queue');
    const order: string[] = [];
    let live = 0;
    let peak = 0;
    const run = (id: string) => async () => {
      live++;
      peak = Math.max(peak, live);
      order.push(id);
      await new Promise((r) => setTimeout(r, 5));
      live--;
    };

    const tail: Promise<void>[] = [];
    await q.push('a', run('a')).then(() => {
      tail.push(q.push('b', run('b')), q.push('c', run('c')));
    });
    await Promise.all(tail);

    expect(peak).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(q.current).toBeNull();
  });

  it('cancelAll resolves queued effects instead of leaving them unsettled', async () => {
    const q = new EffectQueue('queue');
    const aborted = vi.fn();
    const queuedRan = vi.fn();
    const a = q.push('a', (signal) => {
      signal.addEventListener('abort', aborted);
      return new Promise<void>((r) => setTimeout(r, 5));
    });
    const b = q.push('b', async () => {
      queuedRan();
    });
    await Promise.resolve();
    expect(q.current).toBe('a');

    q.cancelAll();

    await expect(b).resolves.toBeUndefined();
    await a;
    expect(aborted).toHaveBeenCalled();
    expect(queuedRan).not.toHaveBeenCalled();
    expect(q.current).toBeNull();
  });

  it('cancelAll aborts in-flight concurrent effects', async () => {
    const q = new EffectQueue('concurrent');
    const aborted = vi.fn();
    const run = (signal: AbortSignal) =>
      new Promise<void>((r) => {
        signal.addEventListener('abort', () => {
          aborted();
          r();
        });
        setTimeout(r, 50);
      });
    const both = Promise.all([q.push('a', run), q.push('b', run)]);
    await Promise.resolve();

    q.cancelAll();

    await both;
    expect(aborted).toHaveBeenCalledTimes(2);
  });

  it('current names the most recently started effect still running', async () => {
    const q = new EffectQueue('concurrent');
    const release: Array<() => void> = [];
    const run = () => new Promise<void>((r) => release.push(r));

    expect(q.current).toBeNull();
    const a = q.push('a', run);
    expect(q.current).toBe('a');
    const b = q.push('b', run);
    expect(q.current).toBe('b');
    expect(release).toHaveLength(2);

    release[1]?.();
    await b;
    expect(q.current).toBe('a');
    release[0]?.();
    await a;
    expect(q.current).toBeNull();
  });

  it('replace starts the new effect only after the aborted one has torn down', async () => {
    const q = new EffectQueue('replace');
    const order: string[] = [];
    const a = q.push(
      'a',
      (signal) =>
        new Promise<void>((r) => {
          signal.addEventListener('abort', () => {
            setTimeout(() => {
              order.push('a:torn-down');
              r();
            }, 10);
          });
        }),
    );
    await Promise.resolve();
    const b = q.push('b', async () => {
      order.push('b:started');
    });

    await Promise.all([a, b]);
    expect(order).toEqual(['a:torn-down', 'b:started']);
  });

  it('replace supersedes an effect that has not started yet', async () => {
    const q = new EffectQueue('replace');
    const order: string[] = [];
    const a = q.push('a', (signal) => {
      order.push('a:started');
      return new Promise<void>((r) => {
        signal.addEventListener('abort', () => {
          setTimeout(() => {
            order.push('a:torn-down');
            r();
          }, 10);
        });
      });
    });
    const b = q.push('b', async () => {
      order.push('b:started');
    });
    const c = q.push('c', async () => {
      order.push('c:started');
    });

    await expect(b).resolves.toBeUndefined();
    await Promise.all([a, c]);

    expect(order).toEqual(['a:started', 'a:torn-down', 'c:started']);
    expect(q.current).toBeNull();
  });
});
