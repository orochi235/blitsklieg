import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LETTERS,
  lettersOf,
  MODES,
  type PanelRecord,
  reconcileLetters,
  seedPanels,
} from '../../../dev/tube-lab/src/panels.js';

function records(...pairs: [string, (typeof MODES)[number]][]): PanelRecord[] {
  return pairs.map(([letter, mode], i) => ({ id: `p${i}`, letter, mode, source: 'depth' }));
}

describe('lettersOf', () => {
  it('keeps typed order and drops repeats and whitespace', () => {
    expect(lettersOf('N S R N')).toEqual(['N', 'S', 'R']);
  });
});

describe('seedPanels', () => {
  it('builds every mode for every letter', () => {
    const seeded = seedPanels(DEFAULT_LETTERS);

    expect(seeded).toHaveLength(4 * MODES.length);
    expect(seeded.filter((p) => p.letter === 'N').map((p) => p.mode)).toEqual([...MODES]);
  });
});

describe('reconcileLetters', () => {
  it('adds one panel per mode for a letter that arrived', () => {
    const { add, remove } = reconcileLetters(records(['N', 'beauty']), 'NE');

    expect(remove).toEqual([]);
    expect(add.map((p) => `${p.letter}:${p.mode}`)).toEqual(MODES.map((m) => `E:${m}`));
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
