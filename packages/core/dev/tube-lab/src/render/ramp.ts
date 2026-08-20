import * as THREE from 'three';
import type { RampSource } from '../panels.js';

/** Only what an unmeasured cell falls back to: the glyph extrude depth (0.3 em) plus margin. */
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
function rampMaterial(source: RampSource): THREE.ShaderMaterial {
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

export interface RampOverride {
  /** The tube material override, one instance per `which`, both on the same depth axis. */
  material(which: 'lit' | 'dark'): THREE.ShaderMaterial;
  /** Rescales the depth axis to the tube geometry `root` ended up with. */
  fit(root: THREE.Object3D): void;
}

/**
 * A depth ramp over a fixed z range says nothing about where the runs actually are: a spec whose
 * amplitude pushes past the range saturates to flat yellow, which reads as "every run is at one
 * frontmost depth" — the opposite of the truth. So the range is measured, not assumed.
 *
 * Measured on the geometry's own boxes rather than the pivot's, because the shader reads
 * `position.z`, which the Word's fit scale never touches.
 */
export function rampOverride(source: RampSource): RampOverride {
  const materials = new Map<'lit' | 'dark', THREE.ShaderMaterial>();
  return {
    material(which) {
      let material = materials.get(which);
      if (!material) {
        material = rampMaterial(source);
        materials.set(which, material);
      }
      return material;
    },
    fit(root) {
      const span = new THREE.Box3().makeEmpty();
      const mine = new Set<THREE.Material>(materials.values());
      root.traverse((object) => {
        const mesh = object as Partial<THREE.Mesh>;
        const geometry = mesh.geometry;
        const material = mesh.material;
        if (!geometry || Array.isArray(material) || !material || !mine.has(material)) return;
        geometry.computeBoundingBox();
        if (geometry.boundingBox) span.union(geometry.boundingBox);
      });
      if (span.isEmpty()) return;
      for (const material of materials.values()) {
        material.uniforms.uDepthMin = { value: span.min.z };
        material.uniforms.uDepthMax = { value: span.max.z };
      }
    },
  };
}
