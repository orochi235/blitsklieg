import type { PoseOffset } from '../pose.js';
import { type ActiveName, type MotionPiece, NONE } from './types.js';

const TAU = Math.PI * 2;

// `sweep` contributes no transform. It exists so the stage knows to rotate the environment,
// which is what actually rakes the highlight across the letters.
const sweep: MotionPiece = {
  duration: 3400,
  offset(): PoseOffset {
    return {};
  },
};

const float: MotionPiece = {
  duration: 5200,
  offset(t): PoseOffset {
    return {
      position: [0, Math.sin(t * TAU) * 0.12, 0],
      rotation: [Math.sin(t * TAU * 2) * 0.03, Math.sin(t * TAU) * 0.1, 0],
    };
  },
};

const pulse: MotionPiece = {
  duration: 1600,
  offset(t): PoseOffset {
    return { scale: 1 + Math.sin(t * TAU) * 0.035 };
  },
};

const shimmer: MotionPiece = {
  duration: 2600,
  offset(t, letter): PoseOffset {
    const phase = t * TAU + (letter.index / Math.max(1, letter.count)) * TAU;
    return { rotation: [0, Math.sin(phase) * 0.05, 0] };
  },
};

export const ACTIVE: Record<ActiveName, MotionPiece> = {
  sweep,
  float,
  pulse,
  shimmer,
  none: NONE,
};

/** Active pieces that drive the environment rather than the transform. */
export const ENV_DRIVEN: ReadonlySet<ActiveName> = new Set<ActiveName>(['sweep']);
