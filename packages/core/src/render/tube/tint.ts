import * as THREE from 'three';

/**
 * Which channel a run's colour drives. A tube look is emissive and its base colour is nearly black;
 * a cord look has no emissive at all and carries its colour on the base. Modulating the wrong one
 * either squares the colour or paints a dark body hot.
 */
export type TintChannel = 'emissive' | 'color';

export const RUN_COLOR_ATTRIBUTE = 'runColor';

/**
 * Drives `channel` from the per-vertex run colour instead of the material's own.
 *
 * Not `vertexColors`, which always modulates diffuse and so cannot reach an emissive look. The
 * material's own channel is set to white so the modulation is exact rather than compounding: the
 * emissive uniform already carries `emissiveIntensity`, so white times the run colour reproduces
 * the colour a look with a matching palette had before.
 */
export function tintByRunColor(material: THREE.Material, channel: TintChannel): void {
  const target = material as THREE.MeshPhysicalMaterial;
  if (channel === 'emissive') target.emissive = new THREE.Color(0xffffff);
  else target.color = new THREE.Color(0xffffff);

  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `attribute vec3 ${RUN_COLOR_ATTRIBUTE};\nvarying vec3 vRunColor;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n  vRunColor = ${RUN_COLOR_ATTRIBUTE};`,
      );
    shader.fragmentShader = `varying vec3 vRunColor;\n${shader.fragmentShader}`.replace(
      channel === 'emissive' ? '#include <emissivemap_fragment>' : '#include <color_fragment>',
      channel === 'emissive'
        ? '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vRunColor;'
        : '#include <color_fragment>\n  diffuseColor.rgb *= vRunColor;',
    );
  };
  // Two materials patched for different channels must not share a compiled program.
  material.customProgramCacheKey = () => `blitsklieg-run-${channel}`;
  material.needsUpdate = true;
}

/** The channel a look carries its colour on. */
export function tintChannelOf(look: { emissive?: number }): TintChannel {
  return look.emissive === undefined ? 'color' : 'emissive';
}
