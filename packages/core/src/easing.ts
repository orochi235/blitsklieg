export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;

export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;

export const easeInCubic: Easing = (t) => t ** 3;

export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

// Overshoots past 1 then settles. c1 tunes how far.
export const backOut: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = t - 1;
  return 1 + c3 * p ** 3 + c1 * p ** 2;
};

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
