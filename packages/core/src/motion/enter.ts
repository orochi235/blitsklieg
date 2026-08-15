import { backOut, easeOutCubic } from '../easing.js';
import type { PoseOffset } from '../pose.js';
import { type EnterName, type MotionPiece, NONE, stagger } from './types.js';

const slam: MotionPiece = {
  duration: 900,
  offset(t): PoseOffset {
    const e = backOut(t);
    return { position: [0, 0, (e - 1) * 26], scale: 0.55 + 0.45 * e };
  },
};

const spin: MotionPiece = {
  duration: 1100,
  offset(t, letter): PoseOffset {
    const s = stagger(t, letter, 0.55);
    const e = easeOutCubic(s);
    return { rotation: [0, (1 - e) * Math.PI * 2, 0], opacity: e };
  },
};

const flip: MotionPiece = {
  duration: 1000,
  offset(t, letter): PoseOffset {
    const s = stagger(t, letter, 0.6);
    const e = easeOutCubic(s);
    return { rotation: [(1 - e) * -Math.PI, 0, 0], opacity: e < 0.05 ? 0 : 1 };
  },
};

const assemble: MotionPiece = {
  duration: 1200,
  offset(t, letter): PoseOffset {
    const e = easeOutCubic(t);
    // Deterministic per-letter scatter: no RNG, so tests and screenshots stay stable.
    const a = letter.index * 2.399963;
    return {
      position: [
        (1 - e) * Math.cos(a) * 9,
        (1 - e) * Math.sin(a) * 6,
        (1 - e) * Math.sin(a * 2) * 5,
      ],
      rotation: [(1 - e) * a, (1 - e) * a * 0.7, 0],
      opacity: easeOutCubic(Math.min(1, t * 2)),
    };
  },
};

const rise: MotionPiece = {
  duration: 900,
  offset(t, letter): PoseOffset {
    const s = stagger(t, letter, 0.35);
    const e = backOut(s);
    return { position: [0, (e - 1) * 5, 0], opacity: Math.min(1, s * 3) };
  },
};

export const ENTER: Record<EnterName, MotionPiece> = {
  slam,
  spin,
  flip,
  assemble,
  rise,
  none: NONE,
};
