import * as THREE from 'three';
import {
  createFlakeUniforms,
  type FlakeSpec,
  type FlakeUniforms,
  patchForFlakes,
  writeFlakeUniforms,
} from './flake.js';

export type LookName =
  | 'gold'
  | 'chrome'
  | 'oil'
  | 'gem'
  | 'velvet'
  | 'neon'
  | 'flake'
  | 'glitter'
  | 'leather';

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
export const LOOKS: Record<LookName, LookSpec> = {
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
    bloom: true,
  },
  flake: {
    color: 0x8a1c2b,
    metalness: 0.9,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    flake: { density: 0.35, size: 0.012, spread: 0.35, color: 0xffd9c0 },
  },
  glitter: {
    color: 0xf6f2ea,
    metalness: 0.25,
    roughness: 0.55,
    clearcoat: 0.4,
    clearcoatRoughness: 0.2,
    flake: { density: 0.6, size: 0.045, spread: 0.85, color: 0xff5ecb },
  },
  leather: {
    color: 0x5a2f1d,
    metalness: 0,
    roughness: 0.72,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
    sheen: 0.35,
    sheenColor: 0xd8a071,
    flake: { density: 1, size: 0.03, spread: 0.22, bump: true },
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

/**
 * A material of your own, in plain numbers. No THREE type appears here: three is a peer
 * dependency and an implementation detail, and accepting a MeshPhysicalMaterial instead would
 * put its types in every consumer's signatures and its churn in this package's compatibility
 * range.
 */
export interface LookSpec extends Partial<LookParams> {
  tintTarget?: TintTarget;
  /** Turns the bloom pass on for this look unless the caller says otherwise. */
  bloom?: boolean;
  flake?: FlakeSpec;
}

export type Look = LookName | LookSpec;

const RANGES: Partial<Record<LookKey, [number, number]>> = {
  metalness: [0, 1],
  roughness: [0, 1],
  clearcoat: [0, 1],
  clearcoatRoughness: [0, 1],
  transmission: [0, 1],
  iridescence: [0, 1],
  sheen: [0, 1],
  sheenRoughness: [0, 1],
  anisotropy: [0, 1],
  thickness: [0, Number.POSITIVE_INFINITY],
  attenuationDistance: [0, Number.POSITIVE_INFINITY],
  emissiveIntensity: [0, Number.POSITIVE_INFINITY],
  ior: [1, 2.333],
  iridescenceIOR: [1, 5],
  dispersion: [0, 10],
};

const PARAM_KEYS = Object.keys(DEFAULTS) as LookKey[];

export function specOf(look: Look): LookSpec {
  return typeof look === 'string' ? LOOKS[look] : look;
}

/** Out of range clamps rather than throws: a bad number should dull a material, not kill an effect. */
function resolveParams(spec: LookSpec): LookParams {
  const params = { ...DEFAULTS };
  for (const key of PARAM_KEYS) {
    const value = spec[key];
    if (value === undefined) continue;
    const range = RANGES[key];
    (params[key] as unknown) =
      range && typeof value === 'number' ? Math.min(Math.max(value, range[0]), range[1]) : value;
  }
  return params;
}

/**
 * The flake chunk is always injected and gated on `uFlakeDensity > 0`, so switching looks never
 * needs a recompile and one program serves every look.
 */
export function createMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ envMapIntensity: 2.2 });
  const uniforms = createFlakeUniforms();
  material.userData.flake = uniforms;
  material.onBeforeCompile = (shader) => patchForFlakes(shader, uniforms);
  return material;
}

/**
 * Color-valued params are THREE.Color objects. Assigning a hex number over one replaces the
 * object and the material silently stops working, so they must go through .set().
 */
export function applyLook(material: THREE.MeshPhysicalMaterial, look: Look, tint?: number): void {
  const spec = specOf(look);
  const params = resolveParams(spec);
  if (tint !== undefined) params[tintTargetOf(params, spec.tintTarget)] = tint;
  const target = material as unknown as Record<string, unknown>;

  // PARAM_KEYS rather than the resolved object's own keys: that is what drops a key a caller
  // invented from ever reaching the material.
  for (const key of PARAM_KEYS) {
    const value = params[key];
    if (COLOR_KEYS.has(key)) (material[key] as THREE.Color).set(value as number);
    else if (Array.isArray(value)) target[key] = [...value];
    else target[key] = value;
  }
  writeFlakeUniforms(material.userData.flake as FlakeUniforms, spec.flake);
  material.needsUpdate = true;
}
