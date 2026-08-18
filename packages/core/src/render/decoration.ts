import * as THREE from 'three';
import type { LookSpec } from './looks.js';

/** A decoration's own material, in the same plain numbers a look takes. */
export type MaterialSpec = Omit<LookSpec, 'decoration' | 'bloom'>;

export interface TubeSpec {
  kind: 'tube';
  /** Tube radius, in em. */
  radius: number;
  /** Depth fractions to sweep a loop at. `[1]` is the front face. */
  at: number[];
  /** Ring segments around the tube. */
  segments: number;
  look: MaterialSpec;
}

export interface TubeBlueprint {
  kind: 'tube';
  loops: THREE.BufferGeometry[];
  dispose(): void;
}

const CONTOUR_SEGMENTS = 48;

// `getPoints` repeats the opening point on a closed contour. Left in, that coincident knot is a
// degenerate segment the closed spline bulges around, and the loop comes out visibly lopsided.
function contourPoints(contour: THREE.Shape | THREE.Path): THREE.Vector2[] {
  const points = contour.getPoints(CONTOUR_SEGMENTS);
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first && last && first.distanceTo(last) < 1e-6) points.pop();
  return points;
}

export function buildTubeBlueprint(
  shapes: THREE.Shape[],
  spec: TubeSpec,
  depth: number,
): TubeBlueprint {
  const loops: THREE.BufferGeometry[] = [];

  for (const shape of shapes) {
    for (const contour of [shape, ...shape.holes]) {
      const points = contourPoints(contour);
      if (points.length < 3) continue;

      for (const at of spec.at) {
        const z = at * depth;
        // Catmull-Rom rounds the corners of an `E`. That is correct here: neon tube cannot bend
        // square, and cord piping does not either.
        const curve = new THREE.CatmullRomCurve3(
          points.map((p) => new THREE.Vector3(p.x, p.y, z)),
          true,
          'centripetal',
        );
        loops.push(
          new THREE.TubeGeometry(curve, points.length * 2, spec.radius, spec.segments, true),
        );
      }
    }
  }

  return {
    kind: 'tube',
    loops,
    dispose() {
      for (const loop of loops) loop.dispose();
      loops.length = 0;
    },
  };
}
