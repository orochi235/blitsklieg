import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BEND_FLOOR,
  ClearanceGrid,
  cornersByBend,
  DEFAULT_BEND,
  type Fillet,
  filletAt,
  minBendRadius,
  vertexBends,
} from '../../../src/render/tube/bend.js';
import { minCurvatureRadius3 } from '../../../src/render/tube/resample.js';

/** A polyline turning by `turn` once, at its middle vertex, with uniform segment length `step`. */
function elbow(turn: number, step: number): THREE.Vector3[] {
  const mid = new THREE.Vector3(0, 0, 0);
  const back = new THREE.Vector3(-step, 0, 0);
  const fwd = new THREE.Vector3(Math.cos(turn) * step, Math.sin(turn) * step, 0);
  return [back.clone().multiplyScalar(2), back, mid, fwd, fwd.clone().multiplyScalar(2)];
}

describe('minBendRadius', () => {
  it('is bend times the tube radius', () => {
    expect(minBendRadius(0.022, 2)).toBeCloseTo(0.044, 6);
  });

  it('defaults to DEFAULT_BEND when the spec sets none', () => {
    expect(minBendRadius(0.022, undefined)).toBeCloseTo(0.022 * DEFAULT_BEND, 6);
  });

  // The mesh turns inside out below 1/CLEARANCE, whatever the look claims about its material.
  it('floors a bend below the point the sweep self-intersects', () => {
    expect(minBendRadius(0.022, 0.5)).toBeCloseTo(0.022 * BEND_FLOOR, 6);
    expect(BEND_FLOOR).toBeCloseTo(1.25, 6);
  });
});

describe('vertexBends', () => {
  // rho = s / (2 sin(theta/2)) is the circumradius of three points spaced s apart turning by theta.
  it('measures a turn as its bend radius', () => {
    const corner = vertexBends(elbow(Math.PI / 3, 0.02), false).find((b) => b.turn > 1e-6);
    expect(corner?.rho).toBeCloseTo(0.02 / (2 * Math.sin(Math.PI / 6)), 5);
  });

  it('reports a straight run as unbounded', () => {
    const straight = [0, 1, 2, 3].map((i) => new THREE.Vector3(i * 0.02, 0, 0));
    for (const b of vertexBends(straight, false)) expect(b.rho).toBe(Number.POSITIVE_INFINITY);
  });

  it("never treats an open path's own endpoints as corners", () => {
    const bends = vertexBends(elbow(Math.PI / 2, 0.02), false);
    expect(bends.map((b) => b.index)).toEqual([1, 2, 3]);
  });
});

describe('cornersByBend', () => {
  it('splits hard from stylistic at rhoMin', () => {
    const points = elbow(Math.PI / 2, 0.02);
    const rho = 0.02 / (2 * Math.sin(Math.PI / 4));
    expect(cornersByBend(points, false, rho * 1.5, rho * 3)[0]?.hard).toBe(true);
    expect(cornersByBend(points, false, rho * 0.5, rho * 3)[0]?.hard).toBe(false);
  });

  it('ignores a turn gentler than the detection threshold', () => {
    expect(cornersByBend(elbow(0.01, 0.02), false, 0.001, 0.002)).toEqual([]);
  });

  // rhoStyle is 1.76r and rhoMin is bend*r, so above bend 1.76 the detection threshold has to be
  // rhoMin or hard corners between the two are never seen. Measured, that strands 13 of them on
  // tubing at bend 2 and 174 at bend 3.
  it('detects a hard corner sitting above rhoStyle', () => {
    const points = elbow(Math.PI / 2, 0.02);
    const rho = 0.02 / (2 * Math.sin(Math.PI / 4));
    const found = cornersByBend(points, false, rho * 2, rho * 0.5);
    expect(found.length).toBe(1);
    expect(found[0]?.hard).toBe(true);
  });

  // A curve sampled finely is many vertices all below the threshold; it is one corner, not twelve.
  it('collapses a consecutive stretch to its tightest vertex', () => {
    const arc: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * Math.PI;
      arc.push(new THREE.Vector3(Math.cos(t) * 0.05, Math.sin(t) * 0.05, 0));
    }
    expect(cornersByBend(arc, false, 1, 1).length).toBe(1);
  });

  /**
   * A rounded square as a superellipse, sampled from `startDeg`. Its corners span several vertices
   * each, so starting at 45 degrees puts one corner's vertices either side of index 0 — the only
   * arrangement that exercises the seam join. A square with single-vertex corners cannot: nothing
   * straddles, and the test passes with the join deleted.
   */
  function roundedSquare(startDeg: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < 64; i++) {
      const t = ((startDeg + (i / 64) * 360) * Math.PI) / 180;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const shape = (v: number) => Math.sign(v) * Math.abs(v) ** (2 / 8);
      out.push(new THREE.Vector3(shape(c) * 0.05, shape(s) * 0.05, 0));
    }
    return out;
  }

  it('finds four corners on a rounded square', () => {
    expect(cornersByBend(roundedSquare(0), true, 0.03, 0.03).length).toBe(4);
  });

  it("joins a corner straddling a closed path's seam", () => {
    expect(cornersByBend(roundedSquare(45), true, 0.03, 0.03).length).toBe(4);
  });
});

describe('filletAt', () => {
  const RHO = 0.044;

  it('replaces the corner with an arc at rhoMin', () => {
    const fillet = filletAt(elbow(Math.PI / 2, 0.4), false, 2, RHO, 0.02);
    expect(fillet).not.toBeNull();
    const measured = minCurvatureRadius3(
      (fillet as Fillet).points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    );
    // Discrete sampling reads a shade under the true arc radius; 10% is sampling error, not slack.
    expect(measured).toBeGreaterThan(RHO * 0.9);
    expect(measured).toBeLessThan(RHO * 1.1);
  });

  it('sets back by rhoMin * tan(theta/2) along each leg', () => {
    const turn = Math.PI / 2;
    const fillet = filletAt(elbow(turn, 0.4), false, 2, RHO, 0.02);
    expect((fillet as Fillet).setback).toBeCloseTo(RHO * Math.tan(turn / 2), 5);
  });

  // Room test: a leg shorter than the setback cannot carry the fillet.
  it('refuses a fillet with no room on its legs', () => {
    expect(filletAt(elbow(Math.PI / 2, 0.002), false, 2, RHO, 0.02)).toBeNull();
  });

  it('starts and ends on the two legs, tangent to each', () => {
    const points = elbow(Math.PI / 3, 0.4);
    const fillet = filletAt(points, false, 2, RHO, 0.02) as Fillet;
    const corner = points[2] as THREE.Vector3;
    const into = corner
      .clone()
      .sub(points[1] as THREE.Vector3)
      .normalize();
    const outOf = (points[3] as THREE.Vector3).clone().sub(corner).normalize();
    const first = fillet.points[0] as THREE.Vector3;
    const last = fillet.points[fillet.points.length - 1] as THREE.Vector3;
    // Each tangent point sits exactly `setback` back along its own leg.
    expect(first.distanceTo(corner.clone().addScaledVector(into, -fillet.setback))).toBeLessThan(
      1e-9,
    );
    expect(last.distanceTo(corner.clone().addScaledVector(outOf, fillet.setback))).toBeLessThan(
      1e-9,
    );
  });

  it('refuses a straight join and a full reversal', () => {
    expect(filletAt(elbow(0, 0.4), false, 2, RHO, 0.02)).toBeNull();
    expect(filletAt(elbow(Math.PI, 0.4), false, 2, RHO, 0.02)).toBeNull();
  });
});

describe('ClearanceGrid', () => {
  const line = (n: number, y: number) =>
    Array.from({ length: n }, (_, i) => new THREE.Vector3(i * 0.02, y, 0));

  it("excludes the probe's own neighbourhood by arc length, not by distance", () => {
    const grid = new ClearanceGrid(0.05);
    grid.add(line(20, 0), 0);
    expect(grid.nearest(new THREE.Vector3(0.1, 0, 0), 0, 0.1)).toBe(Number.POSITIVE_INFINITY);
  });

  it('measures distance to a genuinely separate path', () => {
    const grid = new ClearanceGrid(0.05);
    grid.add(line(20, 0), 0);
    grid.add(line(20, 0.03), 1);
    expect(grid.nearest(new THREE.Vector3(0.1, 0, 0), 0, 0.1)).toBeCloseTo(0.03, 3);
  });

  // The same path doubling back on itself IS a collision, even though it is the same path.
  it("sees a far-along part of the probe's own path", () => {
    const grid = new ClearanceGrid(0.05);
    const hairpin = [...line(20, 0), ...line(20, 0.03).reverse()];
    grid.add(hairpin, 0);
    expect(grid.nearest(new THREE.Vector3(0.1, 0, 0), 0, 0.1)).toBeCloseTo(0.03, 3);
  });

  it('is empty when nothing is within the cell radius', () => {
    const grid = new ClearanceGrid(0.05);
    grid.add(line(20, 0), 0);
    expect(grid.nearest(new THREE.Vector3(0, 5, 0), 1, 0.1)).toBe(Number.POSITIVE_INFINITY);
  });
});
