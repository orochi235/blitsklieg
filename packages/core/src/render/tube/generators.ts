import * as THREE from 'three';
import { isoContours, refineExact, signedDistanceField } from './field.js';
import { offsetRing } from './offset.js';
import { resample } from './resample.js';
import { type Surface, type SurfaceKind, wallPointAt } from './surfaces.js';

export interface GeneratedPath {
  points: THREE.Vector3[];
  surface: SurfaceKind;
  /** True when the path closes on itself, which decides whether cutting must wrap. */
  closed: boolean;
}

/**
 * Where a front/back path comes from. `field` rasterises to a grid and re-extracts; `exact`
 * corrects that grid's magnitude against the real segments; `direct` never builds a grid and
 * traces the contour itself, which means `level` becomes a normal offset and two overlapping
 * contours are no longer resolved into one silhouette.
 */
export type PathSource = 'field' | 'exact' | 'direct';

export interface GenerateOptions {
  /** Isocontour level in em: negative insets, zero rides the outline, positive stands off. */
  level: number;
  spacing: number;
  /** Depth fraction the wall generator runs at, 0 back to 1 front. */
  wallDepth: number;
  /** Peak-to-peak depth swing along a wall path, as a fraction of depth. 0 is a flat band. */
  wallRise?: number;
  resolution: number;
  pad: number;
  source?: PathSource;
}

export function generatePaths(
  surfaces: Surface[],
  enabled: SurfaceKind[],
  opts: GenerateOptions,
): GeneratedPath[] {
  const want = new Set(enabled);
  const out: GeneratedPath[] = [];

  for (const surface of surfaces) {
    if (!want.has(surface.kind)) continue;

    if (surface.kind === 'wall') {
      const steps = Math.max(8, Math.round(surface.perimeter / opts.spacing));
      const rise = opts.wallRise ?? 0;
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < steps; i++) {
        const along = (i / steps) * surface.perimeter;
        const wave = rise === 0 ? 0 : (rise / 2) * Math.sin((i / steps) * Math.PI * 2);
        const depth = Math.min(1, Math.max(0, opts.wallDepth + wave));
        points.push(wallPointAt(surface, along, depth));
      }
      out.push({ points, surface: 'wall', closed: true });
      continue;
    }

    const source = opts.source ?? 'field';

    if (source === 'direct') {
      for (const ring of surface.polygons) {
        const cooked = resample(offsetRing(ring, opts.level), opts.spacing);
        if (cooked.length < 4) continue;
        out.push({
          points: cooked.map((p) => new THREE.Vector3(p.x, p.y, surface.z)),
          surface: surface.kind,
          closed: true,
        });
      }
      continue;
    }

    const base = signedDistanceField(surface.polygons, {
      resolution: opts.resolution,
      pad: opts.pad,
    });
    const field = source === 'exact' ? refineExact(base, surface.polygons, opts.level) : base;
    for (const line of isoContours(field, opts.level)) {
      // Deliberately unsmoothed: cutting detects corners on these points, and smoothing a
      // square's 90 degree corner down to 26 degrees puts it under the detection threshold.
      const cooked = resample(line, opts.spacing);
      if (cooked.length < 4) continue;
      out.push({
        points: cooked.map((p) => new THREE.Vector3(p.x, p.y, surface.z)),
        surface: surface.kind,
        closed: true,
      });
    }
  }

  return out;
}

export interface ConnectorOptions {
  /** How many connectors to emit per front path. */
  count: number;
  /** How far past the back plane the tube continues, in em. */
  overshoot: number;
}

/**
 * Short runs joining a front path to the back plane beneath it, travelling along z. Anchors are
 * spaced evenly along the front path rather than placed at its ends, because the ends move
 * whenever the run count changes and a connector that follows them would jump.
 */
export function generateConnectors(
  paths: GeneratedPath[],
  opts: ConnectorOptions,
): GeneratedPath[] {
  const front = paths.filter((p) => p.surface === 'front');
  const back = paths.filter((p) => p.surface === 'back');
  if (front.length === 0 || back.length === 0) return [];

  const backZ = (back[0]?.points[0] as THREE.Vector3 | undefined)?.z ?? 0;
  const out: GeneratedPath[] = [];

  for (const path of front) {
    if (path.points.length === 0) continue;
    for (let k = 0; k < opts.count; k++) {
      const anchor = path.points[
        Math.floor((k / opts.count) * path.points.length)
      ] as THREE.Vector3;
      const frontZ = anchor.z;
      out.push({
        points: [
          new THREE.Vector3(anchor.x, anchor.y, frontZ),
          new THREE.Vector3(anchor.x, anchor.y, (frontZ + backZ) / 2),
          new THREE.Vector3(anchor.x, anchor.y, backZ - opts.overshoot),
        ],
        surface: 'connector',
        closed: false,
      });
    }
  }
  return out;
}
