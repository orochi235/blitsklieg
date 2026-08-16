import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTIVE } from '../../src/motion/active.js';
import { ENTER } from '../../src/motion/enter.js';
import { EXIT } from '../../src/motion/exit.js';
import type { MotionPiece } from '../../src/motion/types.js';

/**
 * A frozen sample of every motion piece. The vocabulary rewrite has to reproduce these numbers
 * exactly — a diff here is a re-tune wearing a refactor's clothes, and nothing else in the suite
 * would catch one.
 */
const GOLDEN = fileURLToPath(new URL('./golden.json', import.meta.url));

const COUNT = 5;
const STEPS = 20;

function sample(piece: MotionPiece): number[] {
  const out: number[] = [];
  for (let s = 0; s <= STEPS; s++) {
    const t = s / STEPS;
    for (let index = 0; index < COUNT; index++) {
      const o = piece.offset(t, { index, count: COUNT });
      const p = o.position ?? [0, 0, 0];
      const r = o.rotation ?? [0, 0, 0];
      out.push(...p, ...r, o.scale ?? 1, o.opacity ?? 1);
    }
  }
  // 9 places keeps float noise out while still pinning every constant that matters. Negative
  // zero is folded in: JSON writes it as 0, so a round-trip would never match under Object.is.
  return out.map((v) => {
    const n = Number(v.toFixed(9));
    return n === 0 ? 0 : n;
  });
}

function capture(): Record<string, number[]> {
  const all: Record<string, number[]> = {};
  for (const [name, piece] of Object.entries(ENTER)) all[`enter.${name}`] = sample(piece);
  for (const [name, piece] of Object.entries(ACTIVE)) all[`active.${name}`] = sample(piece);
  for (const [name, piece] of Object.entries(EXIT)) all[`exit.${name}`] = sample(piece);
  return all;
}

describe('motion golden', () => {
  it('every piece samples exactly as it did before the vocabulary rewrite', () => {
    const now = capture();

    if (!existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, `${JSON.stringify(now, null, 2)}\n`);
      throw new Error('golden.json did not exist; it has been written. Re-run to compare.');
    }

    expect(now).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });

  it('samples every piece the library ships', () => {
    // Thirteen real pieces plus the shared `none` under each of the three slots.
    expect(Object.keys(capture())).toHaveLength(16);
  });

  it('pins durations too, which the offset samples cannot see', () => {
    const durations = {
      ...Object.fromEntries(Object.entries(ENTER).map(([n, p]) => [`enter.${n}`, p.duration])),
      ...Object.fromEntries(Object.entries(ACTIVE).map(([n, p]) => [`active.${n}`, p.duration])),
      ...Object.fromEntries(Object.entries(EXIT).map(([n, p]) => [`exit.${n}`, p.duration])),
    };

    expect(durations).toEqual({
      'enter.slam': 900,
      'enter.spin': 1100,
      'enter.flip': 1000,
      'enter.assemble': 1200,
      'enter.rise': 900,
      'enter.none': 0,
      'active.sweep': 3400,
      'active.float': 5200,
      'active.pulse': 1600,
      'active.shimmer': 2600,
      'active.none': 0,
      'exit.shatter': 800,
      'exit.drop': 700,
      'exit.recede': 650,
      'exit.fade': 500,
      'exit.none': 0,
    });
  });
});
