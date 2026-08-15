export type Vec3 = [number, number, number];

export interface Pose {
  position: Vec3;
  rotation: Vec3;
  scale: number;
  opacity: number;
}

/** A relative contribution. Omitted fields mean "no contribution". */
export interface PoseOffset {
  position?: Vec3;
  rotation?: Vec3;
  scale?: number;
  opacity?: number;
}

export const REST: Pose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  opacity: 1,
};

export function accumulate(base: Pose, offsets: readonly PoseOffset[]): Pose {
  const position: Vec3 = [...base.position];
  const rotation: Vec3 = [...base.rotation];
  let scale = base.scale;
  let opacity = base.opacity;

  for (const o of offsets) {
    // Vec3 is a fixed 3-tuple, so indices 0..2 are always populated; the `as number`
    // casts are safe despite noUncheckedIndexedAccess widening variable-index reads to T | undefined.
    if (o.position) {
      for (let i = 0; i < 3; i++) position[i] = (position[i] as number) + (o.position[i] as number);
    }
    if (o.rotation) {
      for (let i = 0; i < 3; i++) rotation[i] = (rotation[i] as number) + (o.rotation[i] as number);
    }
    if (o.scale !== undefined) scale *= o.scale;
    if (o.opacity !== undefined) opacity *= o.opacity;
  }

  return { position, rotation, scale, opacity };
}

/**
 * Fade an offset toward identity. Additive fields go to 0; multiplicative fields go to 1 —
 * scaling them toward 0 would collapse the word instead of removing the contribution.
 */
export function scaleOffset(o: PoseOffset, weight: number): PoseOffset {
  const out: PoseOffset = {};
  if (o.position) out.position = o.position.map((v) => v * weight) as Vec3;
  if (o.rotation) out.rotation = o.rotation.map((v) => v * weight) as Vec3;
  if (o.scale !== undefined) out.scale = 1 + (o.scale - 1) * weight;
  if (o.opacity !== undefined) out.opacity = 1 + (o.opacity - 1) * weight;
  return out;
}
