import type { Font } from 'opentype.js';
import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Clock, ManualClock, type Tick } from '../src/clock.js';
import {
  ACTIVE_NAMES,
  type BlitskliegOptions,
  createBlitsklieg,
  ENTER_NAMES,
  EXIT_NAMES,
  LOOK_NAMES,
  POLICY_NAMES,
} from '../src/index.js';
import { BloomPath } from '../src/render/bloom.js';
import { Stage } from '../src/render/stage.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

const UPEM = 1000;
const ADVANCE = 600;
const TAU = Math.PI * 2;
/** Every letter is a 0.5 em box, so each one gets a real mesh. */
const BOX = (size: number) => [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 0.5 * size, y: 0 },
  { type: 'L', x: 0.5 * size, y: -0.7 * size },
  { type: 'Z' },
];

function stubFont(): Font {
  return {
    unitsPerEm: UPEM,
    charToGlyph: () => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({ commands: BOX(size) }),
    }),
    getKerningValue: () => 0,
  } as unknown as Font;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Ignores unsubscribe, so a tick still reaches an effect that has already settled. */
class LeakyClock implements Clock {
  private t = 0;
  private readonly subs = new Set<Tick>();

  now(): number {
    return this.t;
  }

  subscribe(fn: Tick): () => void {
    this.subs.add(fn);
    return () => {};
  }

  advance(deltaMs: number): void {
    this.t += deltaMs;
    for (const fn of [...this.subs]) fn(this.t);
  }
}

let clock: ManualClock;
let calls: string[];
let mounted: Stage | null;
let renderer: THREE.WebGLRenderer;
let renders: number;
let peakWords: number;
/** Hook for the one test that needs a tick to blow up the way a lost context does. */
let onRender: () => void;

function stubStage(): void {
  vi.spyOn(Stage.prototype, 'mount').mockImplementation(function (this: Stage) {
    mounted = this;
    calls.push('mount');
    return renderer;
  });
  vi.spyOn(Stage.prototype, 'scheduleIdleTeardown').mockImplementation(() => {
    calls.push('idle');
  });
  vi.spyOn(Stage.prototype, 'unmount').mockImplementation(() => {
    calls.push('unmount');
  });
}

/** All webglSupported() probes for; every other GL path is stubbed at Stage.mount. */
function stubWebgl(available: boolean): void {
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => (available ? { getExtension: () => null } : null) }),
  });
}

function stubFetch(
  res: Partial<Response> = { ok: true, arrayBuffer: async () => new ArrayBuffer(8) },
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => res as Response),
  );
}

function create(opts: Partial<BlitskliegOptions> = {}) {
  // `target` is never read: Stage.mount is the only thing that appends to it.
  return createBlitsklieg({ fontUrl: '/f.ttf', clock, target: {} as HTMLElement, ...opts });
}

function stage(): Stage {
  if (!mounted) throw new Error('the stage was never mounted');
  return mounted;
}

function words(): THREE.Object3D[] {
  return stage().scene.children;
}

function firstMesh(): THREE.Mesh {
  const group = words()[0] as THREE.Group;
  return group.children[0] as THREE.Mesh;
}

beforeEach(() => {
  clock = new ManualClock();
  calls = [];
  mounted = null;
  renders = 0;
  peakWords = 0;
  onRender = () => {};
  renderer = {
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(320, 240),
    setRenderTarget: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(() => {
      renders++;
      peakWords = Math.max(peakWords, words().length);
      onRender();
    }),
  } as unknown as THREE.WebGLRenderer;

  parse.mockReturnValue(stubFont());
  stubFetch();
  stubWebgl(true);
  stubStage();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Enter, active and exit all zero-length, so the effect finishes on its first tick. */
const INSTANT = { enter: 'none', active: 'none', exit: 'none', hold: 0 } as const;

describe('createBlitsklieg', () => {
  it('mounts, renders and tears the word down when the timeline finishes', async () => {
    const bk = create();
    expect(bk.supported).toBe(true);

    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;

    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(1);
    expect(words()).toHaveLength(0);
  });

  it('reports unsupported and touches neither the stage nor the font', async () => {
    stubWebgl(false);
    const bk = create();

    expect(bk.supported).toBe(false);
    await bk.fire('HELLO');

    expect(calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('constructs and degrades with no document at all', async () => {
    // Not stubWebgl(false): that leaves a document in place, which is the one thing an SSR
    // render does not have, and `supported` exists to survive.
    vi.unstubAllGlobals();
    const bk = createBlitsklieg({ fontUrl: '/f.ttf', clock });

    expect(bk.supported).toBe(false);
    await bk.fire('HELLO');

    expect(calls).toEqual([]);
  });

  it('ignores fire after destroy', async () => {
    const bk = create();
    bk.destroy();

    await bk.fire('HELLO');
    await flush();

    expect(calls).toEqual(['unmount']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('tears the running effect down on abort rather than on the next tick', async () => {
    const bk = create();
    const done = bk.fire('HELLO', { hold: 5000 });
    await flush();
    clock.advance(16);
    expect(calls).toEqual(['mount']);

    bk.destroy();
    await done;
    await flush();

    // No further advance: a hidden tab stops ticking, and destroy() cannot wait for one.
    expect(calls).toEqual(['mount', 'idle', 'unmount']);
    expect(words()).toHaveLength(0);
  });

  it('ignores a tick that arrives after the effect has settled', async () => {
    const leaky = new LeakyClock();
    const bk = create({ clock: leaky });
    const done = bk.fire('HELLO', { hold: 5000 });
    await flush();
    leaky.advance(16);

    bk.destroy();
    await done;
    await flush();
    expect(calls).toEqual(['mount', 'idle', 'unmount']);

    leaky.advance(16);
    expect(calls).toEqual(['mount', 'idle', 'unmount']);
    expect(renders).toBe(1);
  });

  it('unmounts only once a cancelled effect has settled', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }),
    );

    const bk = create();
    const done = bk.fire('HELLO', INSTANT).then(() => calls.push('settled'));
    await flush();
    bk.destroy();
    await flush();
    expect(calls).toEqual([]);

    release();
    await done;
    await flush();
    expect(calls).toEqual(['settled', 'unmount']);
  });

  it('rejects the effect and comes down when a tick throws', async () => {
    const bk = create();
    onRender = () => {
      throw new Error('context lost');
    };
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);

    await expect(done).rejects.toThrow('context lost');
    expect(calls).toEqual(['mount', 'idle']);
    expect(words()).toHaveLength(0);

    // The subscriber is gone, so the throw does not repeat every frame.
    clock.advance(16);
    expect(renders).toBe(1);

    bk.destroy();
    await flush();
    expect(calls).toEqual(['mount', 'idle', 'unmount']);
  });

  it('passes the queue policy through', async () => {
    const bk = create({ policy: 'replace' });
    const first = bk.fire('A', INSTANT);
    const second = bk.fire('B', INSTANT);

    await flush();
    clock.advance(16);
    await first;
    await flush();
    clock.advance(16);
    await second;

    // Under the default `queue` policy both words would play, in turn.
    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(1);
  });

  it('runs queued effects one at a time', async () => {
    const bk = create();
    const a = bk.fire('A', { ...INSTANT, hold: 32 });
    const b = bk.fire('B', INSTANT);

    await flush();
    clock.advance(32);
    await a;
    await flush();
    clock.advance(16);
    await b;

    expect(calls).toEqual(['mount', 'idle', 'mount', 'idle']);
    expect(peakWords).toBe(1);
  });

  it('surfaces a font failure and still loads the font on the next fire', async () => {
    stubFetch({ ok: false, status: 404 });
    const bk = create();

    await expect(bk.fire('HI', INSTANT)).rejects.toThrow('blitsklieg: failed to load font');

    stubFetch();
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;

    expect(calls).toEqual(['mount', 'idle']);
  });

  it('holds the pose the enter settles into under reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const bk = create();
    const done = bk.fire('HI', { enter: 'slam', active: 'sweep', exit: 'fade', hold: 100 });

    await flush();
    clock.advance(16);
    const mesh = firstMesh();
    const material = mesh.material as THREE.MeshPhysicalMaterial;

    // The end of the exit would leave a faded-out word on screen for the whole hold.
    expect(material.opacity).toBeCloseTo(1, 6);
    expect(mesh.position.z).toBeCloseTo(0, 6);
    expect(mesh.scale.x).toBeCloseTo(1, 6);

    clock.advance(100);
    await done;
    expect(calls).toEqual(['mount', 'idle']);
  });

  it('turns the environment once per sweep pass', async () => {
    const bk = create();
    const done = bk.fire('HI', { ...INSTANT, active: 'sweep', hold: 3400 });

    await flush();
    clock.advance(850);
    expect(stage().scene.environmentRotation.y).toBeCloseTo(TAU / 4, 6);

    clock.advance(2550);
    await done;
  });

  it('restarts the sweep per effect and zeroes the environment for pieces that do not drive it', async () => {
    const bk = create();
    const first = bk.fire('HI', { ...INSTANT, active: 'sweep', hold: 1700 });
    await flush();
    clock.advance(1700);
    await first;

    const second = bk.fire('HI', { ...INSTANT, active: 'sweep', hold: 16 });
    await flush();
    clock.advance(16);
    // Absolute clock time would land near TAU / 2 here, wherever the last effect left off.
    expect(stage().scene.environmentRotation.y).toBeCloseTo((16 / 3400) * TAU, 6);
    await second;

    const third = bk.fire('HI', { ...INSTANT, active: 'float' });
    await flush();
    clock.advance(16);
    await third;
    expect(stage().scene.environmentRotation.y).toBe(0);
  });

  describe('bloom', () => {
    /** Real disposal, stubbed drawing: the constructor allocates the targets either way. */
    function stubBloom(render = true) {
      const spies = {
        render: vi.spyOn(BloomPath.prototype, 'render'),
        dispose: vi.spyOn(BloomPath.prototype, 'dispose'),
      };
      if (render) spies.render.mockImplementation(() => {});
      return spies;
    }

    it('renders through the bloom path instead of straight to the canvas', async () => {
      const bloom = stubBloom();
      const bk = create();
      const done = bk.fire('HI', { ...INSTANT, bloom: true });

      await flush();
      clock.advance(16);
      await done;

      expect(bloom.render).toHaveBeenCalledTimes(1);
      expect(bloom.render).toHaveBeenCalledWith(stage().scene, stage().camera);
      expect(renders).toBe(0);
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });

    it('builds nothing when bloom is off', async () => {
      const bloom = stubBloom();
      const bk = create();
      const done = bk.fire('HI', INSTANT);

      await flush();
      clock.advance(16);
      await done;

      expect(bloom.render).not.toHaveBeenCalled();
      expect(bloom.dispose).not.toHaveBeenCalled();
      expect(renders).toBe(1);
    });

    it('disposes the bloom path when the effect is aborted', async () => {
      const bloom = stubBloom();
      const bk = create();
      const done = bk.fire('HI', { bloom: true, hold: 5000 });

      await flush();
      clock.advance(16);
      bk.destroy();
      await done;

      expect(bloom.render).toHaveBeenCalledTimes(1);
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });

    it('disposes the bloom path when the word fails to build', async () => {
      const bloom = stubBloom();
      parse.mockReturnValue({
        ...stubFont(),
        charToGlyph: () => {
          throw new Error('bad glyph');
        },
      } as unknown as Font);
      const bk = create();

      // The rejection comes out before the promise that owns settle() exists.
      await expect(bk.fire('HI', { ...INSTANT, bloom: true })).rejects.toThrow('bad glyph');
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });

    it('disposes the bloom path when a tick throws', async () => {
      const bloom = stubBloom(false);
      onRender = () => {
        throw new Error('context lost');
      };
      const bk = create();
      const done = bk.fire('HI', { ...INSTANT, bloom: true });

      await flush();
      clock.advance(16);

      await expect(done).rejects.toThrow('context lost');
      // The throw came out of the scene pass, so the composite never ran and the targets are live.
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });
  });
});

describe('holding until dismissed', () => {
  type Listener = (e: unknown) => void;
  let listeners: Map<string, Listener[]>;

  /** node has no window event target, so the dismissal listeners need one to attach to. */
  function stubListeners(): void {
    listeners = new Map();
    vi.stubGlobal('addEventListener', (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    });
    vi.stubGlobal('removeEventListener', (type: string, fn: Listener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((f) => f !== fn),
      );
    });
  }

  const dispatch = (type: string, e: unknown = {}) => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
  };
  const attached = () =>
    (listeners.get('pointerdown')?.length ?? 0) + (listeners.get('keydown')?.length ?? 0);

  const HELD = { enter: 'none', active: 'none', exit: 'none', hold: 'click' } as const;

  beforeEach(stubListeners);

  it('stays on screen while a numeric hold would long since have ended', async () => {
    const bk = create();
    const done = bk.fire('HI', HELD);
    await flush();

    clock.advance(60_000);
    await flush();

    expect(words()).toHaveLength(1);
    expect(calls).toEqual(['mount']);

    dispatch('pointerdown');
    clock.advance(16);
    await done;

    expect(words()).toHaveLength(0);
  });

  it('dismisses on Escape as well, so a modal hold is not a keyboard trap', async () => {
    const bk = create();
    const done = bk.fire('HI', { ...HELD, modal: true });
    await flush();
    clock.advance(1000);

    dispatch('keydown', { key: 'Escape' });
    clock.advance(16);
    await done;

    expect(words()).toHaveLength(0);
  });

  it('ignores keys that are not Escape', async () => {
    const bk = create();
    void bk.fire('HI', HELD);
    await flush();
    clock.advance(1000);

    dispatch('keydown', { key: 'a' });
    clock.advance(16);
    await flush();

    expect(words()).toHaveLength(1);
  });

  it('makes the overlay swallow the click only when modal', async () => {
    const interactive = vi.spyOn(Stage.prototype, 'setInteractive').mockImplementation(() => {});

    const bk = create();
    const done = bk.fire('HI', { ...HELD, modal: true });
    await flush();

    expect(interactive).toHaveBeenCalledWith(true);

    dispatch('pointerdown');
    clock.advance(16);
    await done;

    expect(interactive).toHaveBeenLastCalledWith(false);
  });

  it('leaves the overlay click-through when not modal', async () => {
    const interactive = vi.spyOn(Stage.prototype, 'setInteractive').mockImplementation(() => {});

    const bk = create();
    const done = bk.fire('HI', HELD);
    await flush();

    expect(interactive).not.toHaveBeenCalledWith(true);

    dispatch('pointerdown');
    clock.advance(16);
    await done;
  });

  it('detaches its listeners once dismissed', async () => {
    const bk = create();
    const done = bk.fire('HI', HELD);
    await flush();

    expect(attached()).toBe(2);

    dispatch('pointerdown');
    clock.advance(16);
    await done;

    expect(attached()).toBe(0);
  });

  it('detaches its listeners when destroyed while still held', async () => {
    const bk = create();
    const done = bk.fire('HI', HELD);
    await flush();
    expect(attached()).toBe(2);

    bk.destroy();
    await done;

    expect(attached()).toBe(0);
  });

  it('a second press cannot cut the exit short', async () => {
    const bk = create();
    const done = bk.fire('HI', { enter: 'none', active: 'none', exit: 'fade', hold: 'click' });
    await flush();
    clock.advance(1000);

    dispatch('pointerdown');
    clock.advance(100);
    // The exit is underway; pressing again must not re-release at a later elapsed.
    dispatch('pointerdown');
    clock.advance(16);
    await flush();

    expect(words()).toHaveLength(1);

    clock.advance(500);
    await done;

    expect(words()).toHaveLength(0);
  });
});

describe('published name lists', () => {
  // Literal rather than derived: the arrays are already exhaustive by construction, so what is
  // left to pin is the order a picker shows and the fact that dropping one is a breaking change.
  it('lists every name a consumer can fire with, motion-first', () => {
    expect(ENTER_NAMES).toEqual(['slam', 'spin', 'flip', 'assemble', 'rise', 'none']);
    expect(ACTIVE_NAMES).toEqual(['sweep', 'float', 'pulse', 'shimmer', 'none']);
    expect(EXIT_NAMES).toEqual(['shatter', 'drop', 'recede', 'fade', 'none']);
    expect(LOOK_NAMES).toEqual(['gold', 'chrome', 'oil', 'ruby']);
    expect(POLICY_NAMES).toEqual(['queue', 'replace', 'concurrent']);
  });
});
