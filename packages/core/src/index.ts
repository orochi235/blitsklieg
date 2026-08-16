import { type Clock, RafClock } from './clock.js';
import { ACTIVE } from './motion/active.js';
import { type Slot, slotDrivesEnv, slotDuration, Timeline } from './motion/compositor.js';
import { ENTER } from './motion/enter.js';
import { EXIT } from './motion/exit.js';
import type { ActiveName, EnterName, ExitName, MotionPiece } from './motion/types.js';
import { EffectQueue, type QueuePolicy } from './queue.js';
import { BloomPath } from './render/bloom.js';
import { LOOKS, type LookName } from './render/looks.js';
import { prefersReducedMotion, Stage, webglSupported } from './render/stage.js';
import { Word } from './render/word.js';
import { type LoadedFont, loadFont } from './text/font.js';

export { ManualClock } from './clock.js';
export {
  backOut,
  type Easing,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  linear,
  type SpringParams,
  spring,
} from './easing.js';
export {
  type CycleSpec,
  cycle,
  type Keyframe,
  type TransitionSpec,
  transition,
} from './motion/build.js';
export type { LetterInfo, MotionPiece, StaggerFrom, StaggerSpec } from './motion/types.js';
export { stagger } from './motion/types.js';
export type { Pose, PoseOffset, Vec3 } from './pose.js';
export { POLICY_NAMES } from './queue.js';
export type { ActiveName, Clock, EnterName, ExitName, LookName, QueuePolicy };

// Read off the records the effect itself indexes. Those are typed exhaustive over the unions,
// so a name cannot be added, renamed or dropped without these lists following it.
export const ENTER_NAMES: readonly EnterName[] = Object.keys(ENTER) as EnterName[];
export const ACTIVE_NAMES: readonly ActiveName[] = Object.keys(ACTIVE) as ActiveName[];
export const EXIT_NAMES: readonly ExitName[] = Object.keys(EXIT) as ExitName[];
export const LOOK_NAMES: readonly LookName[] = Object.keys(LOOKS) as LookName[];

const TAU = Math.PI * 2;

/** Names index the built-in record; anything else is already a piece the caller supplied. */
function resolveSlot<N extends string>(
  slot: N | MotionPiece | MotionPiece[],
  builtin: Record<N, MotionPiece>,
): Slot {
  return typeof slot === 'string' ? builtin[slot] : slot;
}

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

/** A built-in name, your own piece, or several layered together. */
export type EnterSlot = EnterName | MotionPiece | MotionPiece[];
export type ActiveSlot = ActiveName | MotionPiece | MotionPiece[];
export type ExitSlot = ExitName | MotionPiece | MotionPiece[];

export interface FireOptions {
  enter?: EnterSlot;
  active?: ActiveSlot;
  exit?: ExitSlot;
  look?: LookName;
  /**
   * Milliseconds in the active phase, or `'click'` to hold until the viewer dismisses it.
   * A held effect blocks the queue under the default `queue` policy, and its promise stays
   * pending until it leaves the screen.
   */
  hold?: number | 'click';
  bloom?: boolean;
  blendMs?: number;
  placement?: Placement;
  /** Break long lines to whatever arrangement renders largest. Explicit newlines always break. */
  wrap?: boolean;
  /** Let the overlay swallow the dismissing click instead of passing it through to the page. */
  modal?: boolean;
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
    target: options.target,
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
    const bloom = opts.bloom ? new BloomPath(renderer) : null;
    let word: Word;
    try {
      word = new Word(text, loaded, opts.look ?? 'gold', stage.viewportBudget(), opts.wrap);
    } catch (err) {
      // This rejects before the settle() that would otherwise free the bloom's render targets.
      bloom?.dispose();
      throw err;
    }
    stage.scene.add(word.group);

    const enter = resolveSlot(opts.enter ?? 'slam', ENTER);
    const active = resolveSlot(opts.active ?? 'sweep', ACTIVE);
    const envDriven = slotDrivesEnv(active);
    const hold = opts.hold ?? 1200;
    const untilClick = hold === 'click';
    const timeline = new Timeline({
      enter,
      active,
      exit: resolveSlot(opts.exit ?? 'fade', EXIT),
      hold: untilClick ? 'until-release' : (hold as number),
      blendMs: opts.blendMs ?? 120,
    });

    // Reduced motion: hold the pose the enter settles into for `hold`, then leave. No travel.
    const still = prefersReducedMotion();
    const startedAt = clock.now();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let released = false;
      let detachDismiss = () => {};

      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        off();
        detachDismiss();
        stage.scene.remove(word.group);
        word.dispose();
        bloom?.dispose();
        stage.scheduleIdleTeardown();
        done();
      };
      const finish = () => settle(resolve);

      if (untilClick) {
        const dismiss = () => {
          if (released) return;
          released = true;
          timeline.release(clock.now() - startedAt);
          detachDismiss();
        };
        // Capture on window catches the press in both modes; `modal` only decides whether the
        // canvas absorbs it on the way down or the page underneath sees it too.
        const onPointer = () => dismiss();
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') dismiss();
        };
        globalThis.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
        globalThis.addEventListener('keydown', onKey);
        // A modal hold is a keyboard trap without Escape: it swallows input and never times out.
        if (opts.modal) stage.setInteractive(true);

        detachDismiss = () => {
          globalThis.removeEventListener('pointerdown', onPointer, { capture: true });
          globalThis.removeEventListener('keydown', onKey);
          stage.setInteractive(false);
          detachDismiss = () => {};
        };
      }

      const off = clock.subscribe((now) => {
        if (signal.aborted) return finish();

        try {
          // rAF reports the frame's start time, which can precede a now() sampled moments earlier.
          const since = now - startedAt;
          const settled = slotDuration(enter);
          const elapsed = Math.min(Math.max(still ? settled : since, 0), timeline.duration);
          word.apply(timeline, elapsed);

          // Effect-relative and zeroed off-sweep: absolute clock time would start every sweep at
          // an arbitrary angle and leave the last one's angle behind on the next effect.
          stage.scene.environmentRotation.y = envDriven
            ? (elapsed / Math.max(1, slotDuration(active))) * TAU
            : 0;

          if (bloom) {
            bloom.render(stage.scene, stage.camera);
          } else {
            renderer.setRenderTarget(null);
            renderer.clear();
            renderer.render(stage.scene, stage.camera);
          }

          const stillDone = untilClick ? released : since >= (hold as number);
          if (still ? stillDone : timeline.isFinished(since)) finish();
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
