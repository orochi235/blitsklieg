import type { PoseOffset } from '../pose.js';

export interface LetterInfo {
  /** 0-based position in the word, whitespace included. */
  index: number;
  /** Total letters in the word. */
  count: number;
  /** 0-based line within the block. */
  line?: number;
  /** 0-based column within its own line. */
  column?: number;
  lineCount?: number;
  /** The widest line's length, so a short line's columns do not stretch to fill it. */
  columnCount?: number;
}

export interface MotionPiece {
  /** Milliseconds for one pass. `active` pieces loop; `enter`/`exit` run once. */
  duration: number;
  /** `t` is normalized 0..1 within this pass. */
  offset(t: number, letter: LetterInfo): PoseOffset;
}

export type EnterName = 'slam' | 'spin' | 'flip' | 'assemble' | 'rise' | 'none';
export type ActiveName = 'sweep' | 'float' | 'pulse' | 'shimmer' | 'none';
export type ExitName = 'shatter' | 'drop' | 'recede' | 'fade' | 'none';

/** Stagger helper: returns 0..1 for how far along letter `index` should be at word-time `t`. */
export function stagger(t: number, letter: LetterInfo, spread = 0.5): number {
  const count = Math.max(1, letter.count);
  const start = (letter.index / count) * spread;
  // spread=1 would make span 0, and (t - start) is also 0 at t=start — 0/0 is NaN, which
  // clamps straight through into a transform and makes the letter vanish silently.
  const span = Math.max(1e-6, 1 - spread);
  return Math.max(0, Math.min(1, (t - start) / span));
}

export const NONE: MotionPiece = { duration: 0, offset: () => ({}) };
