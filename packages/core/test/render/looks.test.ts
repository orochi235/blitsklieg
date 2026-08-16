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
  sheen: true,
  sheenColor: true,
  sheenRoughness: true,
  anisotropy: true,
  anisotropyRotation: true,
  dispersion: true,
  emissive: true,
  emissiveIntensity: true,
};
const KEYS = Object.keys(KEY_SET) as (keyof LookParams)[];
const NAMES: LookName[] = ['gold', 'chrome', 'oil', 'gem', 'velvet', 'neon'];

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

  it('gives gem dispersion, which is what separates a stone from red glass', () => {
    expect(withLook('gem').dispersion).toBeGreaterThan(0);
  });

  it('gives velvet a sheen lobe and no clearcoat, since a coat flattens the nap', () => {
    const velvet = withLook('velvet');
    expect(velvet.sheen).toBe(1);
    expect(velvet.clearcoat).toBe(0);
    expect(velvet.metalness).toBe(0);
    expect(velvet.roughness).toBeGreaterThan(0.8);
  });

  it('gives neon an emissive above the bloom threshold over a near-black base', () => {
    const neon = withLook('neon');
    expect(neon.emissive.getHex()).not.toBe(0x000000);
    expect(neon.emissiveIntensity).toBeGreaterThan(1);
    expect(neon.clearcoat).toBe(0);
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

  it('resets every new channel from the defaults', () => {
    const gold = withLook('gold');
    expect(gold.sheen).toBe(0);
    expect(gold.sheenRoughness).toBe(1);
    expect(gold.sheenColor.getHex()).toBe(0xffffff);
    expect(gold.anisotropy).toBe(0);
    expect(gold.anisotropyRotation).toBe(0);
    expect(gold.dispersion).toBe(0);
    expect(gold.emissive.getHex()).toBe(0x000000);
    expect(gold.emissiveIntensity).toBe(1);
  });

  it.each(NAMES)('%s applied over another look matches a fresh material', (name) => {
    const reused = createMaterial();
    for (const previous of NAMES) applyLook(reused, previous);
    applyLook(reused, name);

    expect(snapshot(reused)).toEqual(snapshot(withLook(name)));
  });

  it('leaves no transmission, thickness or attenuation behind when gem is replaced', () => {
    const material = withLook('gem');
    expect(material.transmission).toBe(1);
    expect(material.thickness).toBe(1.4);
    expect(material.attenuationDistance).toBe(0.6);

    applyLook(material, 'gold');
    expect(material.transmission).toBe(0);
    expect(material.thickness).toBe(0);
    expect(material.attenuationDistance).toBe(Number.POSITIVE_INFINITY);
    expect(material.attenuationColor.getHex()).toBe(0xffffff);
    expect(material.dispersion).toBe(0);
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
    const material = withLook('gem');
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
    applyLook(material, 'gem');
    expect(material.version).toBeGreaterThan(before);
  });
});

describe('tint', () => {
  const hex = (c: THREE.Color) => c.getHex();

  it('recolors a metal through its base color', () => {
    const material = createMaterial();
    applyLook(material, 'gold', 0xff2d6f);

    expect(hex(material.color)).toBe(0xff2d6f);
  });

  it('recolors gem through attenuation, which is where its hue actually lives', () => {
    const material = createMaterial();
    applyLook(material, 'gem', 0x2dff8f);

    expect(hex(material.attenuationColor)).toBe(0x2dff8f);
    // Clear glass: tinting the base color instead would have changed nothing visible.
    expect(hex(material.color)).toBe(0xffffff);
  });

  it('leaves every look untinted by default', () => {
    for (const name of Object.keys(LOOKS) as LookName[]) {
      const tinted = createMaterial();
      const plain = createMaterial();
      applyLook(tinted, name);
      applyLook(plain, name);

      expect(hex(tinted.color), name).toBe(hex(plain.color));
      expect(hex(tinted.attenuationColor), name).toBe(hex(plain.attenuationColor));
      expect(hex(tinted.emissive), name).toBe(hex(plain.emissive));
    }
  });

  it('changes exactly one channel, whichever carries the hue', () => {
    for (const name of Object.keys(LOOKS) as LookName[]) {
      const plain = createMaterial();
      const tinted = createMaterial();
      applyLook(plain, name);
      applyLook(tinted, name, 0x123456);

      const moved = [
        hex(plain.color) !== hex(tinted.color),
        hex(plain.attenuationColor) !== hex(tinted.attenuationColor),
        hex(plain.emissive) !== hex(tinted.emissive),
      ].filter(Boolean);

      expect(moved, name).toHaveLength(1);
    }
  });

  it('touches nothing but the hue', () => {
    const plain = createMaterial();
    const tinted = createMaterial();
    applyLook(plain, 'oil');
    applyLook(tinted, 'oil', 0x00ff00);

    expect(tinted.metalness).toBe(plain.metalness);
    expect(tinted.roughness).toBe(plain.roughness);
    expect(tinted.iridescence).toBe(plain.iridescence);
    expect(tinted.clearcoat).toBe(plain.clearcoat);
  });

  it('goes through .set() rather than replacing the Color object', () => {
    const material = createMaterial();
    const before = material.color;

    applyLook(material, 'gold', 0xff2d6f);

    // Replacing it with a number leaves a material that silently stops working.
    expect(material.color).toBe(before);
    expect(material.color).toBeInstanceOf(THREE.Color);
  });

  it('does not leak a tint into the next look applied to the same material', () => {
    const material = createMaterial();
    applyLook(material, 'gold', 0xff2d6f);
    applyLook(material, 'gold');

    expect(hex(material.color)).toBe(0xffc44d);
  });
});
