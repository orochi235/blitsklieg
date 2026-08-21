import * as THREE from 'three';
import { GRADIENT_T_ATTRIBUTE, type GradientSpec, rampTexture } from './gradient.js';

/**
 * Which channel a run's colour drives. A tube look is emissive and its base colour is nearly black;
 * a cord look has no emissive at all and carries its colour on the base. Modulating the wrong one
 * either squares the colour or paints a dark body hot.
 */
export type TintChannel = 'emissive' | 'color';

export const RUN_COLOR_ATTRIBUTE = 'runColor';

export const GRADIENT_BOUNDS_UNIFORM = 'uGradBounds';
export const GRADIENT_ORIGIN_UNIFORM = 'uGradOrigin';
const GRADIENT_RAMP_UNIFORM = 'uGradRamp';

/** Domains the shader resolves from the vertex's own position rather than from an attribute. */
export function positionalDomain(gradient: GradientSpec): boolean {
  return gradient.domain.of === 'axis' || gradient.domain.of === 'radial';
}

/** A GLSL float literal. A bare integer would not compile: GLSL ES 1.00 has no implicit int→float. */
function glslFloat(n: number): string {
  const s = String(Number.isFinite(n) ? n : 0);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/**
 * GLSL assigning `gt`, in letter-placement space. Excludes the group's fit transform deliberately:
 * the fit re-settles on every layout pass, so a gradient riding it would slide on a browser resize.
 */
function positionalT(gradient: GradientSpec): string {
  const head =
    `  vec2 gp = position.xy + ${GRADIENT_ORIGIN_UNIFORM};\n` +
    `  vec2 lo = ${GRADIENT_BOUNDS_UNIFORM}.xy, hi = ${GRADIENT_BOUNDS_UNIFORM}.zw;\n`;

  if (gradient.domain.of === 'radial') {
    const [ax, ay] = gradient.domain.at ?? [0.5, 0.5];
    return (
      head +
      `  vec2 at = mix(lo, hi, vec2(${glslFloat(ax)}, ${glslFloat(ay)}));\n` +
      // The farthest corner, not half the diagonal: an off-centre origin otherwise leaves most of
      // the word in the ramp's tail.
      '  float far = max(max(length(vec2(lo.x, lo.y) - at), length(vec2(hi.x, lo.y) - at)),' +
      ' max(length(vec2(lo.x, hi.y) - at), length(vec2(hi.x, hi.y) - at)));\n' +
      '  float gt = far > 0.0 ? length(gp - at) / far : 0.0;\n'
    );
  }

  const degrees = gradient.domain.of === 'axis' ? (gradient.domain.angle ?? 0) : 0;
  const a = glslFloat((degrees * Math.PI) / 180);
  return (
    head +
    `  vec2 dir = vec2(cos(${a}), sin(${a}));\n` +
    '  float p0 = dot(vec2(lo.x, lo.y), dir), p1 = dot(vec2(hi.x, lo.y), dir);\n' +
    '  float p2 = dot(vec2(lo.x, hi.y), dir), p3 = dot(vec2(hi.x, hi.y), dir);\n' +
    '  float plo = min(min(p0, p1), min(p2, p3));\n' +
    '  float phi = max(max(p0, p1), max(p2, p3));\n' +
    '  float gt = phi > plo ? (dot(gp, dir) - plo) / (phi - plo) : 0.0;\n'
  );
}

/**
 * Drives `channel` from the per-vertex run colour instead of the material's own.
 *
 * Not `vertexColors`, which always modulates diffuse and so cannot reach an emissive look. The
 * material's own channel is set to white so the modulation is exact rather than compounding: the
 * emissive uniform already carries `emissiveIntensity`, so white times the run colour reproduces
 * the colour a look with a matching palette had before.
 *
 * With a `gradient`, the ramp is sampled from a texture baked by `rampTexture` and `t` comes either
 * from the `gradientT` attribute or, for a positional domain, from the vertex's own position.
 *
 * `ramp` lets a caller bake that texture once and share it across the letters of a word; the caller
 * then owns it. Without one this bakes its own, which nothing can reach to dispose — a shared ramp
 * is the supported path for anything that outlives a test.
 */
export function tintByRunColor(
  material: THREE.Material,
  channel: TintChannel,
  gradient?: GradientSpec,
  ramp?: THREE.Texture,
): void {
  const target = material as THREE.MeshPhysicalMaterial;
  if (channel === 'emissive') target.emissive = new THREE.Color(0xffffff);
  else target.color = new THREE.Color(0xffffff);

  const texture = gradient ? (ramp ?? rampTexture(gradient.stops)) : undefined;
  const onPosition = gradient !== undefined && positionalDomain(gradient);
  // Held across compiles: three re-runs onBeforeCompile on every needsUpdate, and rebuilding these
  // would silently discard the bounds the caller had set.
  const boundsUniform = { value: new THREE.Vector4(0, 0, 1, 1) };
  const originUniform = { value: new THREE.Vector2(0, 0) };

  let head = `attribute vec3 ${RUN_COLOR_ATTRIBUTE};\nvarying vec3 vRunColor;\n`;
  let body = `#include <begin_vertex>\n  vRunColor = ${RUN_COLOR_ATTRIBUTE};`;
  if (gradient) {
    head += 'varying float vGradT;\n';
    if (onPosition) {
      head += `uniform vec4 ${GRADIENT_BOUNDS_UNIFORM};\nuniform vec2 ${GRADIENT_ORIGIN_UNIFORM};\n`;
      body += `\n${positionalT(gradient)}  vGradT = clamp(gt, 0.0, 1.0);`;
    } else {
      head += `attribute float ${GRADIENT_T_ATTRIBUTE};\n`;
      body += `\n  vGradT = clamp(${GRADIENT_T_ATTRIBUTE}, 0.0, 1.0);`;
    }
  }

  const sample = `texture2D(${GRADIENT_RAMP_UNIFORM}, vec2(vGradT, 0.5)).rgb`;
  const tinted = !gradient
    ? 'vRunColor'
    : gradient.mode === 'modulate'
      ? `vRunColor * ${sample}`
      : sample;
  const fragHead = gradient
    ? `varying vec3 vRunColor;\nvarying float vGradT;\nuniform sampler2D ${GRADIENT_RAMP_UNIFORM};\n`
    : 'varying vec3 vRunColor;\n';
  const anchor =
    channel === 'emissive' ? '#include <emissivemap_fragment>' : '#include <color_fragment>';
  const write =
    channel === 'emissive'
      ? `totalEmissiveRadiance *= ${tinted};`
      : `diffuseColor.rgb *= ${tinted};`;

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `${head}${shader.vertexShader}`.replace('#include <begin_vertex>', body);
    shader.fragmentShader = `${fragHead}${shader.fragmentShader}`.replace(
      anchor,
      `${anchor}\n  ${write}`,
    );
    if (texture) {
      shader.uniforms[GRADIENT_RAMP_UNIFORM] = { value: texture };
      if (onPosition) {
        // Read here, not at patch time: the word sets these after every letter exists, which is
        // after tintByRunColor has run and before the first compile.
        const bounds = material.userData[GRADIENT_BOUNDS_UNIFORM];
        const origin = material.userData[GRADIENT_ORIGIN_UNIFORM];
        if (bounds instanceof THREE.Vector4) boundsUniform.value = bounds;
        if (origin instanceof THREE.Vector2) originUniform.value = origin;
        shader.uniforms[GRADIENT_BOUNDS_UNIFORM] = boundsUniform;
        shader.uniforms[GRADIENT_ORIGIN_UNIFORM] = originUniform;
      }
    }
  };
  // Two materials patched differently must not share a compiled program. `stops` is absent because
  // it rides a uniform, but the angle and origin are baked into the GLSL and so must part the cache.
  const baked =
    gradient?.domain.of === 'axis'
      ? `-${gradient.domain.angle ?? 0}`
      : gradient?.domain.of === 'radial'
        ? `-${(gradient.domain.at ?? [0.5, 0.5]).join(',')}`
        : '';
  material.customProgramCacheKey = () =>
    `blitsklieg-run-${channel}-${gradient ? `${gradient.domain.of}-${gradient.mode}${baked}` : 'flat'}`;
  material.needsUpdate = true;
}

/** The channel a look carries its colour on. */
export function tintChannelOf(look: { emissive?: number }): TintChannel {
  return look.emissive === undefined ? 'color' : 'emissive';
}
