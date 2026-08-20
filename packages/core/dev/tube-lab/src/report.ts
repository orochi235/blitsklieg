import type { SurfaceKind, TubeBlueprint } from '../../../src/render/tube/index.js';
import { sweepRadius } from '../../../src/render/tube/sweep.js';

export interface RunReport {
  index: number;
  surface: SurfaceKind;
  length: number;
  lit: boolean;
  requested: number;
  /** What `sweepRadius` allowed the run's tightest corner to carry. */
  actual: number;
  clamped: boolean;
  /** `sweepRun` returned null, so this run is absent from `lit` and `dark` but present in `runs`. */
  dropped: boolean;
}

export interface Report {
  runs: RunReport[];
  clamped: number;
  dropped: number;
  summary: string;
}

const EPS = 1e-9;

export function reportOf(blueprint: TubeBlueprint, requested: number): Report {
  const runs = blueprint.runs.map((run) => {
    const drawable = run.points.length >= 2;
    const actual = drawable ? sweepRadius(run, requested) : 0;
    return {
      index: run.index,
      surface: run.surface,
      length: run.length,
      lit: run.lit,
      requested,
      actual,
      clamped: drawable && actual < requested - EPS,
      dropped: !drawable || actual <= 0,
    };
  });
  const clamped = runs.filter((r) => r.clamped).length;
  const dropped = runs.filter((r) => r.dropped).length;
  return {
    runs,
    clamped,
    dropped,
    summary: `${runs.length} runs · ${clamped} clamped · ${dropped} dropped`,
  };
}
