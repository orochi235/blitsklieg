/**
 * Diagnostic-only surface for the lab (`apps/lab`). Not part of blitsklieg's supported API: it
 * carries no compatibility guarantee and is not reachable from the default `blitsklieg` entry
 * point. Word owns per-letter layout and the tube pipeline, so a debug view has to reach these
 * directly rather than re-deriving them outside core.
 */
export { Timeline } from './motion/compositor.js';
export { NONE } from './motion/types.js';
export { Stage } from './render/stage.js';
export type { Point2 } from './render/tube/field.js';
export {
  type FaceSurface,
  type Surface,
  surfacesOf,
  type WallSurface,
} from './render/tube/surfaces.js';
export { Word, type WordDebugHooks } from './render/word.js';
export { type LoadedFont, loadFont } from './text/font.js';
