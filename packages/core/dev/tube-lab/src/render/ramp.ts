import * as THREE from 'three';
import type { RampSource } from '../panels.js';

/** Comfortably brackets the glyph extrude depth (0.3 em) plus wander and amplitude margin. */
const DEPTH_RANGE: [number, number] = [-0.1, 0.4];

const VERTEX_SHADER = `
  varying float vArc;
  varying float vDepth;
  void main() {
    vArc = uv.x;
    vDepth = position.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// One ramp, luminance-increasing indigo -> blue -> teal -> yellow, so depth and arc-length modes
// read the same way and stay legible under red-green color blindness.
const FRAGMENT_SHADER = `
  precision highp float;
  varying float vArc;
  varying float vDepth;
  uniform float uMode;
  uniform float uDepthMin;
  uniform float uDepthMax;

  vec3 ramp(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c0 = vec3(0.03, 0.03, 0.12);
    vec3 c1 = vec3(0.16, 0.20, 0.62);
    vec3 c2 = vec3(0.09, 0.62, 0.55);
    vec3 c3 = vec3(0.99, 0.93, 0.35);
    if (t < 0.333) return mix(c0, c1, t / 0.333);
    if (t < 0.666) return mix(c1, c2, (t - 0.333) / 0.333);
    return mix(c2, c3, (t - 0.666) / 0.334);
  }

  void main() {
    float depthT = clamp((vDepth - uDepthMin) / (uDepthMax - uDepthMin), 0.0, 1.0);
    gl_FragColor = vec4(ramp(uMode > 0.5 ? vArc : depthT), 1.0);
  }
`;

/** One shader, one ramp; `source` only picks which baked scalar (uv.x or position.z) it reads. */
export function rampMaterial(source: RampSource): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uMode: { value: source === 'arc' ? 1 : 0 },
      uDepthMin: { value: DEPTH_RANGE[0] },
      uDepthMax: { value: DEPTH_RANGE[1] },
    },
  });
}
