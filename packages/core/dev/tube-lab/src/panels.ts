export const MODES = ['beauty', 'orbit', 'skeleton', 'ramp'] as const;
export type PanelMode = (typeof MODES)[number];

export const RAMP_SOURCES = ['depth', 'arc'] as const;
export type RampSource = (typeof RAMP_SOURCES)[number];

/** Straight, curved, mixed-with-counter, and one corner spot-check — the standing test string. */
export const DEFAULT_LETTERS = 'NSRE';

/** What a panel node carries in windease `meta`. A panel is this pair, not a cell in a grid. */
export interface PanelMeta {
  letter: string;
  mode: PanelMode;
  source: RampSource;
}

export interface PanelRecord extends PanelMeta {
  id: string;
}

export interface Reconciliation {
  add: PanelMeta[];
  remove: string[];
}

export function isPanelMode(value: unknown): value is PanelMode {
  return MODES.includes(value as PanelMode);
}

export function isRampSource(value: unknown): value is RampSource {
  return RAMP_SOURCES.includes(value as RampSource);
}

/** The field's distinct characters in typed order; whitespace is not a letter. */
export function lettersOf(text: string): string[] {
  return [...new Set([...text.replace(/\s+/g, '')])];
}

export function seedPanels(letters: string): PanelMeta[] {
  return lettersOf(letters).flatMap((letter) =>
    MODES.map((mode) => ({ letter, mode, source: 'depth' as RampSource })),
  );
}

/**
 * What to add and what to destroy so the panel set covers exactly `letters`. A letter already on
 * screen is left alone whatever panels it has, so editing the field never disturbs an
 * arrangement the user built.
 */
export function reconcileLetters(
  existing: readonly PanelRecord[],
  letters: string,
): Reconciliation {
  const wanted = lettersOf(letters);
  const have = new Set(existing.map((p) => p.letter));
  const keep = new Set(wanted);
  return {
    add: wanted
      .filter((l) => !have.has(l))
      .flatMap((letter) => MODES.map((mode) => ({ letter, mode, source: 'depth' as RampSource }))),
    remove: existing.filter((p) => !keep.has(p.letter)).map((p) => p.id),
  };
}
