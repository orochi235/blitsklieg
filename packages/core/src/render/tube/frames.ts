import * as THREE from 'three';

export interface Frame {
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
}

/** Tangent estimate at each point via central difference; endpoints use a one-sided difference. */
function estimateTangents(points: THREE.Vector3[]): THREE.Vector3[] {
  const n = points.length;
  const raw: (THREE.Vector3 | null)[] = points.map((_, i) => {
    const a = points[Math.max(0, i - 1)] as THREE.Vector3;
    const b = points[Math.min(n - 1, i + 1)] as THREE.Vector3;
    const d = b.clone().sub(a);
    return d.lengthSq() > 1e-20 ? d.normalize() : null;
  });
  let last = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < n; i++) {
    if (raw[i]) last = raw[i] as THREE.Vector3;
    else raw[i] = last.clone();
  }
  return raw as THREE.Vector3[];
}

/** A unit vector orthogonal to `tangent`, built from whichever axis is least parallel to it. */
export function seedNormal(tangent: THREE.Vector3): THREE.Vector3 {
  const ax = Math.abs(tangent.x);
  const ay = Math.abs(tangent.y);
  const az = Math.abs(tangent.z);
  const axis =
    ax <= ay && ax <= az
      ? new THREE.Vector3(1, 0, 0)
      : ay <= az
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
  return axis.sub(tangent.clone().multiplyScalar(axis.dot(tangent))).normalize();
}

/** Reflects `v` across the plane through the origin perpendicular to `axis` (`axis` need not be unit). */
function reflect(v: THREE.Vector3, axis: THREE.Vector3): THREE.Vector3 {
  const c = axis.lengthSq();
  if (c < 1e-20) return v.clone();
  const k = (2 * axis.dot(v)) / c;
  return v.clone().sub(axis.clone().multiplyScalar(k));
}

/**
 * Rotation-minimizing frames along a polyline, via the double-reflection method (Wang, Jüttler,
 * Zheng & Liu, "Computation of Rotation Minimizing Frames", ACM TOG 2008). Unlike Frenet frames
 * this needs no second derivative, so it stays defined and stable through inflections and
 * near-straight spans instead of flipping there.
 */
export function rotationMinimizingFrames(points: THREE.Vector3[]): Frame[] {
  const n = points.length;
  if (n === 0) return [];
  const tangents = estimateTangents(points);
  const frames: Frame[] = new Array(n);
  const t0 = tangents[0] as THREE.Vector3;
  const r0 = seedNormal(t0);
  frames[0] = { tangent: t0, normal: r0, binormal: t0.clone().cross(r0).normalize() };

  for (let i = 0; i < n - 1; i++) {
    const cur = frames[i] as Frame;
    const v1 = (points[i + 1] as THREE.Vector3).clone().sub(points[i] as THREE.Vector3);
    const rL = reflect(cur.normal, v1);
    const tL = reflect(cur.tangent, v1);
    const tNext = tangents[i + 1] as THREE.Vector3;
    const v2 = tNext.clone().sub(tL);
    const rNext = reflect(rL, v2).normalize();
    frames[i + 1] = {
      tangent: tNext,
      normal: rNext,
      binormal: tNext.clone().cross(rNext).normalize(),
    };
  }

  return frames;
}
