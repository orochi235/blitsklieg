import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rampOverride } from '../../../dev/tube-lab/src/render/ramp.js';

/** A run at `z`, as one flat quad, hung under a group the Word's fit has already scaled. */
function run(z: number, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.translate(0, 0, z);
  return new THREE.Mesh(geometry, material);
}

function scaledPivot(...meshes: THREE.Mesh[]): THREE.Group {
  const word = new THREE.Group();
  word.scale.setScalar(4.7);
  for (const mesh of meshes) word.add(mesh);
  const pivot = new THREE.Group();
  pivot.add(word);
  return pivot;
}

describe('rampOverride', () => {
  it('gives one material per side, and the same one every time', () => {
    const ramp = rampOverride('depth');

    expect(ramp.material('lit')).toBe(ramp.material('lit'));
    expect(ramp.material('lit')).not.toBe(ramp.material('dark'));
  });

  it('puts both ends of the ramp on the geometry it is colouring', () => {
    const ramp = rampOverride('depth');
    const pivot = scaledPivot(run(0.04, ramp.material('lit')), run(0.31, ramp.material('dark')));

    ramp.fit(pivot);

    for (const which of ['lit', 'dark'] as const) {
      const uniforms = ramp.material(which).uniforms;
      expect(uniforms.uDepthMin?.value).toBeCloseTo(0.04, 6);
      expect(uniforms.uDepthMax?.value).toBeCloseTo(0.31, 6);
    }
  });

  it('measures in geometry space, so the depth axis is not the Word fit scale', () => {
    const ramp = rampOverride('depth');
    const pivot = scaledPivot(run(0.3, ramp.material('lit')));
    // The body of the letter is not drawn with the ramp, so it must not stretch the axis.
    pivot.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 9), new THREE.MeshBasicMaterial()));

    ramp.fit(pivot);

    expect(ramp.material('lit').uniforms.uDepthMax?.value).toBeCloseTo(0.3, 6);
  });

  it('leaves the fallback range alone when nothing was drawn with it', () => {
    const ramp = rampOverride('depth');
    const before = ramp.material('lit').uniforms.uDepthMax?.value;

    ramp.fit(new THREE.Group());

    expect(ramp.material('lit').uniforms.uDepthMax?.value).toBe(before);
  });
});
