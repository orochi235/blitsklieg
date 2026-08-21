import * as THREE from 'three';

/**
 * A colour the ramp passes through at `t`. Stops are sRGB hex; the returned colour is in three's
 * linear working space, because that is what `new THREE.Color(hex)` produces and what the shader
 * reads. Lerping sRGB components instead sends pink→cyan through grey.
 */
export function rampAt(stops: readonly number[], t: number): THREE.Color {
  if (stops.length === 0) return new THREE.Color(0xffffff);
  const first = stops[0] as number;
  if (stops.length === 1) return new THREE.Color(first);

  const u = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  const f = u - i;
  const a = new THREE.Color(stops[i] as number);
  const b = new THREE.Color(stops[i + 1] as number);
  return a.lerp(b, f);
}
