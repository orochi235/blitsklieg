export type LightingName = 'sweep' | 'static';

export interface LightingMode {
  /** Milliseconds for one full turn of the environment. Zero holds it still. */
  periodMs: number;
}

export const LIGHTING: Record<LightingName, LightingMode> = {
  sweep: { periodMs: 3400 },
  static: { periodMs: 0 },
};

const TAU = Math.PI * 2;

/** Effect-relative: absolute clock time would start every effect at an arbitrary angle. */
export function envRotationAt(name: LightingName, elapsed: number): number {
  const { periodMs } = LIGHTING[name];
  return periodMs > 0 ? (elapsed / periodMs) * TAU : 0;
}
