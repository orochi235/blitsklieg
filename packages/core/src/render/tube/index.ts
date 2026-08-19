import type * as THREE from 'three';
import type { MaterialSpec } from '../decoration.js';
import { assign, type SelectSpec } from './assign.js';
import { generateConnectors, generatePaths } from './generators.js';
import { cutIntoRuns, type Run } from './runs.js';
import type { SurfaceKind } from './surfaces.js';
import { surfacesOf } from './surfaces.js';
import { sweepRun } from './sweep.js';

export type { SelectSpec } from './assign.js';
export type { Run } from './runs.js';
export type { SurfaceKind } from './surfaces.js';

export interface TubeSpec {
  kind: 'tube';
  /** Tube radius in em, tapered down where the path's curvature cannot carry it. */
  radius: number;
  /** Ring segments around the tube. */
  segments: number;
  /** Arc length in em between resampled path points. */
  spacing: number;
  surfaces: SurfaceKind[];
  /** Isocontour level in em: negative insets, zero rides the outline, positive stands off. */
  level: number;
  /** Requested runs per glyph. Bounded below by the corner count, above by `minRun`. */
  runs: number;
  minRun: number;
  /** Depth fraction the wall generator runs at, 0 back to 1 front. */
  wallDepth?: number;
  /** Peak-to-peak depth swing along a wall path, as a fraction of depth. */
  wallRise?: number;
  select: SelectSpec;
  colors: number[];
  look: MaterialSpec;
  /** Unlit glass. Present so a dark run is visibly there rather than missing. */
  dark: MaterialSpec;
  /** Connectors emitted per front path when both faces are enabled. 0 disables them. */
  connectors?: number;
  /** How far a connector continues past the back plane, in em. */
  connectorOvershoot?: number;
}

export interface TubeBlueprint {
  kind: 'tube';
  runs: Run[];
  lit: THREE.BufferGeometry[];
  dark: THREE.BufferGeometry[];
  dispose(): void;
}

/** Grid cells per side for the face field, and the margin exterior levels need. */
const RESOLUTION = 256;
const PAD = 0.35;

export function buildTubeBlueprint(
  shapes: THREE.Shape[],
  spec: TubeSpec,
  depth: number,
  seed: number,
): TubeBlueprint {
  const surfaces = surfacesOf(shapes, depth);
  const paths = generatePaths(surfaces, spec.surfaces, {
    level: spec.level,
    spacing: spec.spacing,
    wallDepth: spec.wallDepth ?? 0.5,
    wallRise: spec.wallRise,
    resolution: RESOLUTION,
    pad: PAD,
  });
  const links =
    spec.connectors && spec.connectors > 0
      ? generateConnectors(paths, {
          count: spec.connectors,
          overshoot: spec.connectorOvershoot ?? 0.05,
        })
      : [];
  const runs = assign(
    cutIntoRuns([...paths, ...links], { runs: spec.runs, minRun: spec.minRun }),
    spec.select,
    spec.colors,
    seed,
  );

  const lit: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  for (const run of runs) {
    const geo = sweepRun(run, spec.radius, spec.segments);
    if (!geo) continue;
    (run.lit ? lit : dark).push(geo);
  }

  return {
    kind: 'tube',
    runs,
    lit,
    dark,
    dispose() {
      for (const g of lit) g.dispose();
      for (const g of dark) g.dispose();
      lit.length = 0;
      dark.length = 0;
      runs.length = 0;
    },
  };
}
