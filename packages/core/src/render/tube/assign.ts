import type { Run } from './runs.js';

export interface SelectSpec {
  /** How runs are ordered before the amount is taken off the front. */
  by: 'seed' | 'length' | 'index';
  /** 0..1 is a fraction of the run count; above 1 is a literal count. */
  amount: number;
  /** Only read when `by` is 'index': light every nth run. */
  stride?: number;
}

/** Same generator the chunk scatter uses, so seeding behaves consistently across decorations. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sets `lit` and `color` in place of the incoming order. The run list order never changes —
 * a post-effects layer addresses runs by index, so reordering here would silently retarget it.
 */
export function assign(runs: Run[], select: SelectSpec, colors: number[], seed: number): Run[] {
  if (runs.length === 0) return runs;

  if (select.by === 'index' && select.stride && select.stride > 1) {
    const stride = Math.round(select.stride);
    for (const run of runs) run.lit = run.index % stride === 0;
  } else {
    const count =
      select.amount > 1
        ? Math.min(runs.length, Math.round(select.amount))
        : Math.round(Math.min(1, Math.max(0, select.amount)) * runs.length);

    let order: number[];
    if (select.by === 'length') {
      order = runs
        .map((r) => [r.length, r.index] as const)
        .sort((a, b) => b[0] - a[0])
        .map(([, i]) => i);
    } else if (select.by === 'index') {
      order = runs.map((r) => r.index);
    } else {
      const random = rng(Math.round(seed * 2654435761) ^ 0x5eed);
      order = runs
        .map((r) => [random(), r.index] as const)
        .sort((a, b) => a[0] - b[0])
        .map(([, i]) => i);
    }

    const chosen = new Set(order.slice(0, count));
    for (const run of runs) run.lit = chosen.has(run.index);
  }

  const palette = colors.length > 0 ? colors : [0xffffff];
  let n = 0;
  for (const run of runs) {
    if (!run.lit) continue;
    run.color = palette[n % palette.length] as number;
    n++;
  }
  return runs;
}
