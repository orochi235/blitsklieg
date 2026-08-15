import { type Clock, RafClock } from './clock.js';
import { ACTIVE, ENV_DRIVEN } from './motion/active.js';
import { Timeline } from './motion/compositor.js';
import { ENTER } from './motion/enter.js';
import { EXIT } from './motion/exit.js';
import type { ActiveName, EnterName, ExitName } from './motion/types.js';
import { EffectQueue, type QueuePolicy } from './queue.js';
import type { LookName } from './render/looks.js';
import { Stage, prefersReducedMotion, webglSupported } from './render/stage.js';
import { Word } from './render/word.js';
import { type LoadedFont, loadFont } from './text/font.js';

export type { EnterName, ActiveName, ExitName, LookName, QueuePolicy, Clock };

const TAU = Math.PI * 2;

export interface BlitskliegOptions {
  target?: HTMLElement;
  fontUrl: string;
  clock?: Clock;
  /**
   * `concurrent` is unsound for `sweep`: every live effect writes the shared environment
   * rotation from its own elapsed time, so the highlight sawtooths between their phases.
   */
  policy?: QueuePolicy;
  idleTimeoutMs?: number;
}

/** Closed union so element-anchoring can arrive in v1.2 without an API break. */
export type Placement = { kind: 'fullscreen' };

export interface FireOptions {
  enter?: EnterName;
  active?: ActiveName;
  exit?: ExitName;
  look?: LookName;
  hold?: number;
  bloom?: boolean;
  blendMs?: number;
  placement?: Placement;
}

export interface Blitsklieg {
  readonly supported: boolean;
  /** Resolves when the effect leaves the screen, whether it played out or was cancelled. */
  fire(text: string, options?: FireOptions): Promise<void>;
  /** Cancels everything in flight; the stage comes down once the running effect has settled. */
  destroy(): void;
}

export function createBlitsklieg(options: BlitskliegOptions): Blitsklieg {
  const supported = webglSupported();
  const clock = options.clock ?? new RafClock();
  const queue = new EffectQueue(options.policy ?? 'queue');
  const stage = new Stage({
    target: options.target ?? document.body,
    idleTimeoutMs: options.idleTimeoutMs ?? 8000,
  });

  let fontPromise: Promise<LoadedFont> | null = null;
  function font(): Promise<LoadedFont> {
    if (fontPromise) return fontPromise;
    // Memoizing the rejection too would make one failed fetch permanent for this instance.
    fontPromise = loadFont(options.fontUrl).catch((err) => {
      fontPromise = null;
      throw err;
    });
    return fontPromise;
  }

  async function run(text: string, opts: FireOptions, signal: AbortSignal): Promise<void> {
    const loaded = await font();
    if (signal.aborted) return;

    const renderer = stage.mount();
    const word = new Word(text, loaded, opts.look ?? 'gold', stage.viewportBudget());
    stage.scene.add(word.group);

    const enter = ENTER[opts.enter ?? 'slam'];
    const activeName = opts.active ?? 'sweep';
    const hold = opts.hold ?? 1200;
    const timeline = new Timeline({
      enter,
      active: ACTIVE[activeName],
      exit: EXIT[opts.exit ?? 'fade'],
      hold,
      blendMs: opts.blendMs ?? 120,
    });

    // Reduced motion: hold the pose the enter settles into for `hold`, then leave. No travel.
    const still = prefersReducedMotion();
    const startedAt = clock.now();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        off();
        stage.scene.remove(word.group);
        word.dispose();
        stage.scheduleIdleTeardown();
        done();
      };
      const finish = () => settle(resolve);

      const off = clock.subscribe((now) => {
        if (signal.aborted) return finish();

        try {
          // rAF reports the frame's start time, which can precede a now() sampled moments earlier.
          const since = now - startedAt;
          const elapsed = Math.min(Math.max(still ? enter.duration : since, 0), timeline.duration);
          word.apply(timeline, elapsed);

          // Effect-relative and zeroed off-sweep: absolute clock time would start every sweep at
          // an arbitrary angle and leave the last one's angle behind on the next effect.
          stage.scene.environmentRotation.y = ENV_DRIVEN.has(activeName)
            ? (elapsed / ACTIVE[activeName].duration) * TAU
            : 0;

          renderer.setRenderTarget(null);
          renderer.clear();
          renderer.render(stage.scene, stage.camera);

          if (still ? since >= hold : timeline.isFinished(since)) finish();
        } catch (err) {
          // RafClock keeps a throwing subscriber subscribed, so a lost context would otherwise
          // throw every frame forever with the word still on a stage destroy() can never settle.
          settle(() => reject(err));
        }
      });

      // Teardown must not wait for a tick: rAF stops in a hidden tab, and destroy() holds a
      // scarce GL context until this effect settles.
      signal.addEventListener('abort', finish);
      if (signal.aborted) finish();
    });
  }

  let counter = 0;
  let destroyed = false;

  return {
    supported,
    fire(text, opts = {}) {
      if (!supported || destroyed) return Promise.resolve();
      return queue.push(`${counter++}:${text}`, (signal) => run(text, opts, signal));
    },
    destroy() {
      destroyed = true;
      // A running effect only notices the abort on its next tick, and tearing down first would
      // leave it re-arming idle teardown against a stage that is already gone.
      void queue.cancelAll().then(() => stage.unmount());
    },
  };
}
