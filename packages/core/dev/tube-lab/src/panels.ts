export const MODES = ['beauty', 'skeleton', 'ramp'] as const;
export type PanelMode = (typeof MODES)[number];

/** Where a panel is looked at from, which every mode answers separately from what it draws. */
export const POSES = ['head-on', 'turned'] as const;
export type Pose = (typeof POSES)[number];

export const RAMP_SOURCES = ['depth', 'arc'] as const;
export type RampSource = (typeof RAMP_SOURCES)[number];

/**
 * The extremes, not the representative set: a 26-letter sweep puts M at 0.32r and W at 0.38r
 * against N's 0.44r, so `NSRE` cannot show the worst case. S is the pure-curve case with the
 * fewest corners and no counter; B has two.
 */
export const DEFAULT_LETTERS = 'MWSB';

/** What a panel node carries in windease `meta`. A panel is this pair, not a cell in a grid. */
export interface PanelMeta {
  letter: string;
  mode: PanelMode;
  pose: Pose;
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

export function isPose(value: unknown): value is Pose {
  return POSES.includes(value as Pose);
}

export function isRampSource(value: unknown): value is RampSource {
  return RAMP_SOURCES.includes(value as RampSource);
}

/** The field's distinct characters in typed order; whitespace is not a letter. */
export function lettersOf(text: string): string[] {
  return [...new Set([...text.replace(/\s+/g, '')])];
}

/**
 * A letter's starting set: the head-on beauty render everything else is judged against, the same
 * render turned, and the two diagnostics. This is the only place a starting pose is set.
 */
export function panelsFor(letter: string): PanelMeta[] {
  return [
    { letter, mode: 'beauty', pose: 'head-on', source: 'depth' },
    { letter, mode: 'beauty', pose: 'turned', source: 'depth' },
    { letter, mode: 'skeleton', pose: 'head-on', source: 'depth' },
    { letter, mode: 'ramp', pose: 'head-on', source: 'depth' },
  ];
}

export function seedPanels(letters: string): PanelMeta[] {
  return lettersOf(letters).flatMap(panelsFor);
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
    add: wanted.filter((l) => !have.has(l)).flatMap(panelsFor),
    remove: existing.filter((p) => !keep.has(p.letter)).map((p) => p.id),
  };
}
