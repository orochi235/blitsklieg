import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { assign } from '../../../src/render/tube/assign.js';
import type { Run } from '../../../src/render/tube/runs.js';

function runs(n: number): Run[] {
  return Array.from({ length: n }, (_, i) => ({
    points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(i + 1, 0, 0)],
    surface: 'front' as const,
    length: i + 1,
    index: i,
    lit: true,
    color: 0,
  }));
}

const COLORS = [0xff0000, 0x00ff00, 0x0000ff];

describe('assign', () => {
  it('lights everything at amount 1', () => {
    const out = assign(runs(6), { by: 'seed', amount: 1 }, COLORS, 3);
    expect(out.every((r) => r.lit)).toBe(true);
  });

  it('lights nothing at amount 0', () => {
    const out = assign(runs(6), { by: 'seed', amount: 0 }, COLORS, 3);
    expect(out.some((r) => r.lit)).toBe(false);
  });

  it('reads an amount above 1 as a count', () => {
    const out = assign(runs(10), { by: 'length', amount: 4 }, COLORS, 3);
    expect(out.filter((r) => r.lit)).toHaveLength(4);
  });

  it('lights the longest runs when ordering by length', () => {
    const out = assign(runs(10), { by: 'length', amount: 3 }, COLORS, 3);
    expect(
      out
        .filter((r) => r.lit)
        .map((r) => r.index)
        .sort((a, b) => a - b),
    ).toEqual([7, 8, 9]);
  });

  it('alternates when ordering by index with a stride', () => {
    const out = assign(runs(6), { by: 'index', amount: 1, stride: 2 }, COLORS, 3);
    expect(out.filter((r) => r.lit).map((r) => r.index)).toEqual([0, 2, 4]);
  });

  it('is deterministic for the same seed and unequal for different ones', () => {
    const a = assign(runs(12), { by: 'seed', amount: 0.5 }, COLORS, 3).map((r) => r.lit);
    const b = assign(runs(12), { by: 'seed', amount: 0.5 }, COLORS, 3).map((r) => r.lit);
    const c = assign(runs(12), { by: 'seed', amount: 0.5 }, COLORS, 9).map((r) => r.lit);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('cycles the palette across runs and tolerates a single color', () => {
    const many = assign(runs(5), { by: 'seed', amount: 1 }, COLORS, 3);
    expect(many.map((r) => r.color)).toEqual([0xff0000, 0x00ff00, 0x0000ff, 0xff0000, 0x00ff00]);
    const one = assign(runs(3), { by: 'seed', amount: 1 }, [0xabcdef], 3);
    expect(one.every((r) => r.color === 0xabcdef)).toBe(true);
  });

  it('leaves the run order untouched', () => {
    const out = assign(runs(6), { by: 'length', amount: 2 }, COLORS, 3);
    expect(out.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
