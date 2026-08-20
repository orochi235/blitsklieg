import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LETTERS,
  lettersOf,
  type MODES,
  type PanelRecord,
  reconcileLetters,
  seedPanels,
} from '../../../dev/tube-lab/src/panels.js';

function records(...pairs: [string, (typeof MODES)[number]][]): PanelRecord[] {
  return pairs.map(([letter, mode], i) => ({
    id: `p${i}`,
    letter,
    mode,
    pose: 'head-on',
    source: 'depth',
  }));
}

describe('lettersOf', () => {
  it('keeps typed order and drops repeats and whitespace', () => {
    expect(lettersOf('N S R N')).toEqual(['N', 'S', 'R']);
  });
});

describe('seedPanels', () => {
  it('gives every letter a head-on reference, a turned one, and the two diagnostics', () => {
    const seeded = seedPanels(DEFAULT_LETTERS);

    expect(seeded).toHaveLength(4 * 4);
    expect(seeded.filter((p) => p.letter === 'N').map((p) => `${p.mode}:${p.pose}`)).toEqual([
      'beauty:head-on',
      'beauty:turned',
      'skeleton:head-on',
      'ramp:head-on',
    ]);
  });
});

describe('reconcileLetters', () => {
  it('adds the seeded set for a letter that arrived', () => {
    const { add, remove } = reconcileLetters(records(['N', 'beauty']), 'NE');

    expect(remove).toEqual([]);
    expect(add.map((p) => `${p.letter}:${p.mode}:${p.pose}`)).toEqual([
      'E:beauty:head-on',
      'E:beauty:turned',
      'E:skeleton:head-on',
      'E:ramp:head-on',
    ]);
  });

  it('removes every panel of a letter that left', () => {
    const existing = records(['N', 'beauty'], ['E', 'ramp'], ['E', 'skeleton']);
    const { add, remove } = reconcileLetters(existing, 'N');

    expect(add).toEqual([]);
    expect(remove).toEqual(['p1', 'p2']);
  });

  it('leaves a letter the user already pruned to one panel alone', () => {
    const { add, remove } = reconcileLetters(records(['N', 'skeleton']), 'N');

    expect(add).toEqual([]);
    expect(remove).toEqual([]);
  });
});
