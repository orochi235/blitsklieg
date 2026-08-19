import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type Frame, rotationMinimizingFrames } from '../../../src/render/tube/frames.js';

/** An S-curve that bends first one way then the other in x/y, and also wanders in z. */
function sCurve(n: number): THREE.Vector3[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return new THREE.Vector3(t * 2 - 1, Math.sin(t * Math.PI * 2), Math.sin(t * Math.PI) * 0.3);
  });
}

function straightLine(n: number): THREE.Vector3[] {
  return Array.from({ length: n }, (_, i) => new THREE.Vector3(i * 0.1, i * 0.1, i * 0.05));
}

describe('rotationMinimizingFrames', () => {
  it('keeps every frame orthonormal', () => {
    const frames = rotationMinimizingFrames(sCurve(50));
    for (const f of frames) {
      expect(f.tangent.length()).toBeCloseTo(1, 5);
      expect(f.normal.length()).toBeCloseTo(1, 5);
      expect(f.binormal.length()).toBeCloseTo(1, 5);
      expect(f.tangent.dot(f.normal)).toBeCloseTo(0, 4);
      expect(f.tangent.dot(f.binormal)).toBeCloseTo(0, 4);
      expect(f.normal.dot(f.binormal)).toBeCloseTo(0, 4);
    }
  });

  it('does not flip the reference frame across an inflection point', () => {
    const frames = rotationMinimizingFrames(sCurve(50));
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1] as Frame;
      const cur = frames[i] as Frame;
      // A true rotation-minimizing frame turns gradually; a Frenet frame flips the normal by
      // close to 180 degrees at an inflection. Adjacent RMF normals should stay near-aligned.
      expect(prev.normal.dot(cur.normal)).toBeGreaterThan(0.9);
    }
  });

  it('produces a constant frame along a straight run', () => {
    const frames = rotationMinimizingFrames(straightLine(20));
    const first = frames[0] as Frame;
    for (const f of frames) {
      expect(f.normal.dot(first.normal)).toBeCloseTo(1, 5);
      expect(f.binormal.dot(first.binormal)).toBeCloseTo(1, 5);
    }
  });

  it('handles a single point without producing NaNs', () => {
    const frames = rotationMinimizingFrames([new THREE.Vector3(0, 0, 0)]);
    expect(frames).toHaveLength(1);
    expect(Number.isNaN((frames[0] as Frame).normal.x)).toBe(false);
  });
});
