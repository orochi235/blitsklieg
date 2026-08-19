import * as THREE from 'three';
import { isoContours, signedDistanceField } from './field.js';
import { resample } from './resample.js';
import { type Surface, type SurfaceKind, wallPointAt } from './surfaces.js';

export interface GeneratedPath {
  points: THREE.Vector3[];
  surface: SurfaceKind;
  /** True when the path closes on itself, which decides whether cutting must wrap. */
  closed: boolean;
}

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

    const field = signedDistanceField(surface.polygons, {
      resolution: opts.resolution,
      pad: opts.pad,
    });
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
