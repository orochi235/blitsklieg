import * as THREE from 'three';

export type LookName = 'gold' | 'chrome' | 'oil' | 'gem' | 'velvet' | 'neon';

/** Extract silently drops a name that is not a real material property, so a typo fails DEFAULTS. */
type LookKey = Extract<
  keyof THREE.MeshPhysicalMaterial,
  | 'color'
  | 'metalness'
  | 'roughness'
  | 'clearcoat'
  | 'clearcoatRoughness'
  | 'transmission'
  | 'thickness'
  | 'ior'
  | 'attenuationColor'
  | 'attenuationDistance'
  | 'iridescence'
  | 'iridescenceIOR'
  | 'iridescenceThicknessRange'
  | 'sheen'
  | 'sheenColor'
  | 'sheenRoughness'
  | 'anisotropy'
  | 'anisotropyRotation'
  | 'dispersion'
  | 'emissive'
  | 'emissiveIntensity'
>;

export type LookParams = {
  [K in LookKey]: K extends 'iridescenceThicknessRange' ? [number, number] : number;
};

export const DEFAULTS: LookParams = {
  color: 0xffffff,
  metalness: 0,
  roughness: 0.2,
  clearcoat: 1,
  clearcoatRoughness: 0.06,
  transmission: 0,
  thickness: 0,
  ior: 1.5,
  attenuationColor: 0xffffff,
  attenuationDistance: Number.POSITIVE_INFINITY,
  iridescence: 0,
  iridescenceIOR: 1.3,
  iridescenceThicknessRange: [100, 400],
  sheen: 0,
  // three defaults this to black, which mutes the lobe even at sheen: 1. White means a spec
  // that sets only `sheen` gets a visible one.
  sheenColor: 0xffffff,
  sheenRoughness: 1,
  anisotropy: 0,
  anisotropyRotation: 0,
  dispersion: 0,
  emissive: 0x000000,
  emissiveIntensity: 1,
};

// Every look is applied over DEFAULTS, never over the previous look, so switching cannot
// leave a stale transmission or iridescence behind.
export const LOOKS: Record<LookName, Partial<LookParams>> = {
  gold: { color: 0xffc44d, metalness: 1, roughness: 0.16, clearcoatRoughness: 0.08 },
  chrome: { color: 0xf2f5fa, metalness: 1, roughness: 0.05, clearcoatRoughness: 0.03 },
  oil: {
    color: 0x0a0a12,
    metalness: 1,
    roughness: 0.12,
    clearcoatRoughness: 0.05,
    // clearcoat sits ABOVE the thin film and flattens it; iridescence needs it off.
    clearcoat: 0,
    iridescence: 1,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [100, 640],
  },
  gem: {
    color: 0xffffff,
    roughness: 0.06,
    transmission: 1,
    thickness: 1.4,
    ior: 2.2,
    attenuationColor: 0xd4143c,
    attenuationDistance: 0.6,
    clearcoatRoughness: 0.03,
    dispersion: 4,
  },
  velvet: {
    color: 0x7a1030,
    metalness: 0,
    roughness: 0.95,
    // A clearcoat sits above the nap and mirrors over it; the sheen lobe needs it off.
    clearcoat: 0,
    sheen: 1,
    sheenColor: 0xff6ea8,
    sheenRoughness: 0.35,
  },
  neon: {
    color: 0x120018,
    metalness: 0,
    roughness: 0.4,
    clearcoat: 0,
    emissive: 0xff2d95,
    emissiveIntensity: 3.2,
  },
};

export const COLOR_KEYS = new Set<LookKey>(['color', 'attenuationColor', 'sheenColor', 'emissive']);

export type TintTarget = 'color' | 'attenuationColor' | 'emissive' | 'sheenColor';

/**
 * Which property carries a look's hue. Not always `color`: `gem` is clear stone at
 * `color: 0xffffff` and its red is what light picks up passing through it, and `neon` is a
 * near-black body whose color is entirely its emissive. `sheenColor` is reachable only by
 * declaring it — a velvet reads by its body, and tinting only the highlight would answer
 * "make it red" with red-lit maroon.
 */
export function tintTargetOf(params: LookParams, declared?: TintTarget): TintTarget {
  if (declared) return declared;
  if (params.transmission > 0) return 'attenuationColor';
  if (params.emissive !== 0x000000) return 'emissive';
  return 'color';
}

export function createMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ envMapIntensity: 2.2 });
}

/**
 * Color-valued params are THREE.Color objects. Assigning a hex number over one replaces the
 * object and the material silently stops working, so they must go through .set().
 */
export function applyLook(
  material: THREE.MeshPhysicalMaterial,
  name: LookName,
  tint?: number,
): void {
  const params = { ...DEFAULTS, ...LOOKS[name] };
  if (tint !== undefined) params[tintTargetOf(params)] = tint;
  const target = material as unknown as Record<string, unknown>;

  for (const key of Object.keys(params) as LookKey[]) {
    const value = params[key];
    if (COLOR_KEYS.has(key)) (material[key] as THREE.Color).set(value as number);
    else if (Array.isArray(value)) target[key] = [...value];
    else target[key] = value;
  }
  material.needsUpdate = true;
}
