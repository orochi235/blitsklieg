import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FILL, fitter, labCamera } from '../../../dev/tube-lab/src/render/cell.js';

/** A tubing glyph as measured: the tube stands most of a glyph depth in front of the word plane. */
const SIZE = { x: 1.674, y: 1.79, z: 1.183 };
const FRONT = 1.062;

function pivotWithBox(): THREE.Group {
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(SIZE.x, SIZE.y, SIZE.z));
  mesh.position.z = FRONT - SIZE.z / 2;
  pivot.add(mesh);
  return pivot;
}

/** What fraction of the viewport's smaller side the content covers, on the plane it sits on. */
function minSideFill(pivot: THREE.Group, aspect: number): number {
  const camera = labCamera();
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  // project() reads matrixWorldInverse, which the constructor's position never wrote.
  camera.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(pivot);
  const lo = new THREE.Vector3(box.min.x, box.min.y, box.max.z).project(camera);
  const hi = new THREE.Vector3(box.max.x, box.max.y, box.max.z).project(camera);
  return Math.max(
    ((hi.x - lo.x) / 2) * Math.max(1, aspect),
    ((hi.y - lo.y) / 2) * Math.max(1, 1 / aspect),
  );
}

describe('the tube lab panel fit', () => {
  // A fit measured on the word plane instead of the tube's overshoots to ~0.98 at every aspect,
  // which the scissor then cuts. The spread of aspects is what pins the min-side rule.
  it.each([1, 5.65, 0.15, 100, 0.01])('fills the smaller side of a %f panel', (aspect) => {
    const pivot = pivotWithBox();
    fitter(pivot)(aspect);

    expect(minSideFill(pivot, aspect)).toBeCloseTo(FILL, 4);
  });

  it('leaves a rejected aspect unscaled', () => {
    const pivot = pivotWithBox();
    fitter(pivot)(0);

    expect(pivot.scale.x).toBe(1);
  });
});
