import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyLook,
  COLOR_KEYS,
  createMaterial,
  LOOKS,
  type LookName,
  type LookParams,
} from '../../src/render/looks.js';

const KEY_SET: Record<keyof LookParams, true> = {
  color: true,
  metalness: true,
  roughness: true,
  clearcoat: true,
  clearcoatRoughness: true,
  transmission: true,
  thickness: true,
  ior: true,
  attenuationColor: true,
  attenuationDistance: true,
  iridescence: true,
  iridescenceIOR: true,
  iridescenceThicknessRange: true,
};
const KEYS = Object.keys(KEY_SET) as (keyof LookParams)[];
const NAMES: LookName[] = ['gold', 'chrome', 'oil', 'ruby'];

function snapshot(material: THREE.MeshPhysicalMaterial): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KEYS) {
    const value = material[key];
    out[key] = value instanceof THREE.Color ? value.getHex() : value;
  }
  return out;
}

function withLook(name: LookName): THREE.MeshPhysicalMaterial {
  const material = createMaterial();
  applyLook(material, name);
  return material;
}

describe('createMaterial', () => {
  it('is a physical material with the envMap intensity the looks are tuned against', () => {
    const material = createMaterial();
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material.envMapIntensity).toBe(2.2);
  });
});

describe('LOOKS', () => {
  it('has an entry for every name in the union', () => {
    expect(Object.keys(LOOKS).sort()).toEqual([...NAMES].sort());
  });

  it('turns clearcoat off for oil, since a coat above the thin film flattens it', () => {
    expect(withLook('oil').clearcoat).toBe(0);
    expect(withLook('oil').iridescence).toBe(1);
  });
});

describe('COLOR_KEYS', () => {
  it('names exactly the params three stores as Color objects', () => {
    const fresh = new THREE.MeshPhysicalMaterial();
    const colorValued = KEYS.filter((key) => fresh[key] instanceof THREE.Color);
    expect([...COLOR_KEYS].sort()).toEqual(colorValued.sort());
  });
});

describe('applyLook', () => {
  it('fills unspecified params from the defaults rather than leaving three own values', () => {
    const gold = withLook('gold');
    expect(gold.clearcoat).toBe(1);
    expect(gold.transmission).toBe(0);
    expect(gold.thickness).toBe(0);
    expect(gold.iridescence).toBe(0);
    expect(gold.attenuationDistance).toBe(Number.POSITIVE_INFINITY);
  });

  it.each(NAMES)('%s applied over another look matches a fresh material', (name) => {
    const reused = createMaterial();
    for (const previous of NAMES) applyLook(reused, previous);
    applyLook(reused, name);

    expect(snapshot(reused)).toEqual(snapshot(withLook(name)));
  });

  it('leaves no transmission, thickness or attenuation behind when ruby is replaced', () => {
    const material = withLook('ruby');
    expect(material.transmission).toBe(1);
    expect(material.thickness).toBe(1.4);
    expect(material.attenuationDistance).toBe(0.6);

    applyLook(material, 'gold');
    expect(material.transmission).toBe(0);
    expect(material.thickness).toBe(0);
    expect(material.attenuationDistance).toBe(Number.POSITIVE_INFINITY);
    expect(material.attenuationColor.getHex()).toBe(0xffffff);
  });

  it('leaves no iridescence behind when oil is replaced', () => {
    const material = withLook('oil');
    applyLook(material, 'chrome');
    expect(material.iridescence).toBe(0);
    expect(material.iridescenceIOR).toBe(1.3);
    expect(material.iridescenceThicknessRange).toEqual([100, 400]);
    expect(material.clearcoat).toBe(1);
  });

  it('sets color-valued params through .set(), keeping the Color object', () => {
    const material = withLook('ruby');
    expect(material.color).toBeInstanceOf(THREE.Color);
    expect(material.attenuationColor).toBeInstanceOf(THREE.Color);
    expect(material.color.getHex()).toBe(0xffffff);
    expect(material.attenuationColor.getHex()).toBe(0xd4143c);

    applyLook(material, 'gold');
    expect(material.color).toBeInstanceOf(THREE.Color);
    expect(material.color.getHex()).toBe(0xffc44d);
  });

  it('gives each material its own thickness range instead of sharing the module constant', () => {
    const a = withLook('oil');
    const b = withLook('oil');
    expect(a.iridescenceThicknessRange).toEqual([100, 640]);
    expect(a.iridescenceThicknessRange).not.toBe(b.iridescenceThicknessRange);

    a.iridescenceThicknessRange[1] = 999;
    expect(b.iridescenceThicknessRange[1]).toBe(640);
    expect(withLook('oil').iridescenceThicknessRange[1]).toBe(640);
  });

  it('marks the material for recompile, since transmission and iridescence change the program', () => {
    const material = createMaterial();
    const before = material.version;
    applyLook(material, 'ruby');
    expect(material.version).toBeGreaterThan(before);
  });
});
