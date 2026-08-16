import * as THREE from 'three';

export interface FlakeSpec {
  /** Fraction of cells that are flakes, 0..1. Zero disables the chunk. */
  density: number;
  /** Cell edge in object-space units — glyphs are built at 1 em. */
  size: number;
  /** How far a flake normal tilts off the surface, 0..1. */
  spread: number;
  color?: number;
  /** Smooth rounded cells (leather grain) instead of flat random facets. */
  bump?: boolean;
}

export interface FlakeUniforms {
  uFlakeDensity: THREE.IUniform<number>;
  uFlakeSize: THREE.IUniform<number>;
  uFlakeSpread: THREE.IUniform<number>;
  uFlakeBump: THREE.IUniform<number>;
  uFlakeColor: THREE.IUniform<THREE.Color>;
  uSeed: THREE.IUniform<number>;
}

export function createFlakeUniforms(): FlakeUniforms {
  return {
    uFlakeDensity: { value: 0 },
    uFlakeSize: { value: 0.02 },
    uFlakeSpread: { value: 0.4 },
    uFlakeBump: { value: 0 },
    uFlakeColor: { value: new THREE.Color(0xffffff) },
    uSeed: { value: 0 },
  };
}

export function writeFlakeUniforms(u: FlakeUniforms, spec: FlakeSpec | undefined): void {
  u.uFlakeDensity.value = spec ? spec.density : 0;
  if (!spec) return;
  u.uFlakeSize.value = spec.size;
  u.uFlakeSpread.value = spec.spread;
  u.uFlakeBump.value = spec.bump ? 1 : 0;
  u.uFlakeColor.value.set(spec.color ?? 0xffffff);
}

const COMMON = /* glsl */ `
uniform float uFlakeDensity;
uniform float uFlakeSize;
uniform float uFlakeSpread;
uniform float uFlakeBump;
uniform vec3 uFlakeColor;
uniform float uSeed;
varying vec3 vFlakePos;

vec3 bkHash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}

vec3 bkCellCoord() { return vFlakePos / uFlakeSize + uSeed; }

float bkIsFlake(vec3 rnd) { return step(1.0 - uFlakeDensity, rnd.x * 0.5 + 0.5); }
`;

// Sub-pixel flakes strobe violently under minification. Contrast fades and roughness widens as a
// cell approaches one pixel, so distant type goes evenly rough instead of boiling.
const PERTURB = /* glsl */ `
if (uFlakeDensity > 0.0) {
  vec3 bkCoord = bkCellCoord();
  vec3 bkRnd = bkHash3(floor(bkCoord));
  float bkFade = 1.0 - smoothstep(0.35, 1.0, fwidth(length(bkCoord)));

  vec3 bkLocal = fract(bkCoord) - 0.5;
  vec3 bkDome = normalize(vec3(bkLocal.xy * 2.0, 0.6));
  vec3 bkOffset = mix(bkRnd, bkDome, uFlakeBump);

  normal = normalize(normal + bkOffset * uFlakeSpread * bkIsFlake(bkRnd) * bkFade);
  roughnessFactor = clamp(roughnessFactor + (1.0 - bkFade) * 0.25, 0.0, 1.0);
}
`;

const TINT = /* glsl */ `
if (uFlakeDensity > 0.0) {
  vec3 bkRnd = bkHash3(floor(bkCellCoord()));
  diffuseColor.rgb = mix(diffuseColor.rgb, uFlakeColor, bkIsFlake(bkRnd) * 0.6);
}
`;

export interface PatchableShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
}

export function patchForFlakes(shader: PatchableShader, uniforms: FlakeUniforms): void {
  Object.assign(shader.uniforms, uniforms);

  shader.vertexShader = `varying vec3 vFlakePos;\n${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\nvFlakePos = transformed;',
  );

  shader.fragmentShader = `${COMMON}${shader.fragmentShader}`
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${PERTURB}`)
    .replace('#include <color_fragment>', `#include <color_fragment>${TINT}`);
}
