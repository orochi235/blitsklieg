import { easeInCubic, easeOutCubic } from '../easing.js';
import type { PoseOffset } from '../pose.js';
import { type ExitName, type MotionPiece, NONE } from './types.js';

const shatter: MotionPiece = {
  duration: 800,
  offset(t, letter): PoseOffset {
    const e = easeOutCubic(t);
    // Deterministic per-letter scatter: no RNG, so tests and screenshots stay stable.
    const a = letter.index * 2.399963;
    return {
      position: [Math.cos(a) * 10 * e, Math.sin(a) * 7 * e, Math.sin(a * 3) * 6 * e],
      rotation: [a * e * 3, a * e * 2, a * e],
      opacity: 1 - easeInCubic(t),
    };
  },
};

const drop: MotionPiece = {
  duration: 700,
  offset(t, letter): PoseOffset {
    const g = t * t; // gravity
    return {
      position: [0, -22 * g, 0],
      rotation: [0, 0, g * (letter.index % 2 === 0 ? 0.9 : -0.9)],
      opacity: 1 - easeInCubic(t),
    };
  },
};

const recede: MotionPiece = {
  duration: 650,
  offset(t): PoseOffset {
    const e = easeInCubic(t);
    return { position: [0, 0, -30 * e], scale: 1 - 0.5 * e, opacity: 1 - e };
  },
};

const fade: MotionPiece = {
  duration: 500,
  offset(t): PoseOffset {
    return { opacity: 1 - t, scale: 1 + 0.06 * t };
  },
};

export const EXIT: Record<ExitName, MotionPiece> = {
  shatter,
  drop,
  recede,
  fade,
  none: NONE,
};
