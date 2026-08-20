/**
 * The floor on `bend`, inherited from the sweep's old CLEARANCE of 0.8: a tube may occupy at most
 * that fraction of its path's curvature radius before the inner wall passes through itself.
 */
export const BEND_FLOOR = 1.25;
export const DEFAULT_BEND = 2;

/** Minimum bend radius in em. `bend` is a multiple of `radius`, so changing radius cannot break it. */
export function minBendRadius(radius: number, bend: number | undefined): number {
  return radius * Math.max(BEND_FLOOR, bend ?? DEFAULT_BEND);
}
