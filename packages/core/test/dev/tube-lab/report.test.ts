import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { reportOf } from '../../../dev/tube-lab/src/report.js';
import type { Run } from '../../../src/render/tube/index.js';

/** An arc of `radius` swept through a quarter turn, at the arc-length spacing the pipeline uses. */
function arcRun(radius: number, index: number): Run {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * (Math.PI / 2);
    points.push(new THREE.Vector3(radius * Math.cos(t), radius * Math.sin(t), 0));
  }
  return { points, surface: 'front', length: (radius * Math.PI) / 2, index, lit: true, color: 0 };
}

function blueprint(runs: Run[]) {
  return { kind: 'tube' as const, runs, corners: [], lit: [], dark: [], dispose() {} };
}

describe('reportOf', () => {
  it('reports the radius a run actually got, and flags the clamp', () => {
    const report = reportOf(blueprint([arcRun(0.1, 0)]), 0.05);

    const run = report.runs[0];
    expect(run?.requested).toBe(0.05);
    expect(run?.actual).toBe(0.05);
    expect(run?.clamped).toBe(false);
  });

  it('flags a run whose corner cannot carry the requested radius', () => {
    const report = reportOf(blueprint([arcRun(0.02, 0)]), 0.05);

    expect(report.runs[0]?.clamped).toBe(true);
    // sweepRadius allows 80% of the tightest curvature radius, measured after smoothing.
    expect(report.runs[0]?.actual).toBeCloseTo(0.016, 3);
    expect(report.clamped).toBe(1);
  });

  it('counts a run that vanished rather than leaving it silently absent', () => {
    const dot: Run = {
      points: [new THREE.Vector3()],
      surface: 'front',
      length: 0,
      index: 0,
      lit: true,
      color: 0,
    };
    const report = reportOf(blueprint([dot]), 0.05);

    expect(report.runs[0]?.dropped).toBe(true);
    expect(report.dropped).toBe(1);
  });

  it('summarises as the panel reads it', () => {
    const report = reportOf(blueprint([arcRun(0.1, 0), arcRun(0.02, 1)]), 0.05);

    expect(report.summary).toBe('2 runs · 1 clamped · 0 dropped');
  });
});
