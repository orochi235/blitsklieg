import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createFlakeUniforms,
  type FlakeUniforms,
  patchForFlakes,
  seedGeometry,
  writeFlakeUniforms,
} from '../../src/render/flake.js';

function stubShader() {
  return {
    vertexShader: '#include <begin_vertex>\nvoid main(){}',
    fragmentShader: '#include <normal_fragment_maps>\n#include <color_fragment>\nvoid main(){}',
    uniforms: {} as Record<string, THREE.IUniform>,
  };
}

function patched(): ReturnType<typeof stubShader> {
  const shader = stubShader();
  patchForFlakes(shader, createFlakeUniforms());
  return shader;
}

describe('createFlakeUniforms', () => {
  it('starts disabled, so a look declaring no flakes costs nothing but a branch', () => {
    expect(createFlakeUniforms().uFlakeDensity.value).toBe(0);
  });

  it('gives each material its own uniform objects', () => {
    expect(createFlakeUniforms().uFlakeDensity).not.toBe(createFlakeUniforms().uFlakeDensity);
  });
});

describe('seedGeometry', () => {
  it('clones rather than writing the seed onto the cached original', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));

    const seeded = seedGeometry(source, 4.5);

    expect(seeded).not.toBe(source);
    expect(source.getAttribute('aSeed')).toBeUndefined();
  });

  it('gives every vertex the same seed', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));

    const attribute = seedGeometry(source, 4.5).getAttribute('aSeed');

    expect(attribute.count).toBe(3);
    expect([...(attribute.array as Float32Array)]).toEqual([4.5, 4.5, 4.5]);
  });
});

describe('writeFlakeUniforms', () => {
  it('carries a spec onto the uniforms', () => {
    const u = createFlakeUniforms();
    writeFlakeUniforms(u, { density: 0.4, size: 0.02, spread: 0.5, color: 0xff0000 });

    expect(u.uFlakeDensity.value).toBe(0.4);
    expect(u.uFlakeSize.value).toBe(0.02);
    expect(u.uFlakeSpread.value).toBe(0.5);
    expect(u.uFlakeColor.value.getHex()).toBe(0xff0000);
  });

  it('disables the chunk when a look declares no flakes', () => {
    const u = createFlakeUniforms();
    writeFlakeUniforms(u, { density: 0.4, size: 0.02, spread: 0.5 });
    writeFlakeUniforms(u, undefined);

    expect(u.uFlakeDensity.value).toBe(0);
  });

  it('turns rounded cells on only for a bump spec', () => {
    const u = createFlakeUniforms();
    writeFlakeUniforms(u, { density: 1, size: 0.03, spread: 0.2, bump: true });
    expect(u.uFlakeBump.value).toBe(1);

    writeFlakeUniforms(u, { density: 1, size: 0.03, spread: 0.2 });
    expect(u.uFlakeBump.value).toBe(0);
  });

  it('sets the color object rather than replacing it', () => {
    const u = createFlakeUniforms();
    const before = u.uFlakeColor.value;
    writeFlakeUniforms(u, { density: 1, size: 0.01, spread: 0.1, color: 0x00ff00 });

    expect(u.uFlakeColor.value).toBe(before);
  });
});

describe('patchForFlakes', () => {
  it('installs the uniform objects the material already owns, not copies', () => {
    const u = createFlakeUniforms();
    const shader = stubShader();
    patchForFlakes(shader, u);

    expect(shader.uniforms.uFlakeDensity).toBe(u.uFlakeDensity);
    expect(shader.uniforms.uFlakeColor).toBe(u.uFlakeColor);
  });

  it('carries object-space position through to the fragment stage', () => {
    const shader = patched();

    expect(shader.vertexShader).toContain('varying vec3 vFlakePos');
    expect(shader.vertexShader).toContain('vFlakePos = transformed');
    expect(shader.fragmentShader).toContain('varying vec3 vFlakePos');
  });

  it('gates the whole chunk on density, so one program serves every look', () => {
    expect(patched().fragmentShader).toContain('uFlakeDensity > 0.0');
  });

  it('picks cells from a jittered neighbourhood, or flakes tile into a visible mosaic', () => {
    const shader = patched();

    expect(shader.fragmentShader).toContain('bkVoronoi(');
    expect(shader.fragmentShader).toContain('bkCell(');
  });

  it('declares no helper it does not define, which only a GL compile would otherwise catch', () => {
    const source = patched().fragmentShader;
    const called = [...source.matchAll(/\b(bk[A-Za-z0-9]*)\s*\(/g)].map((m) => m[1] as string);

    for (const name of new Set(called)) {
      expect(source, name).toMatch(new RegExp(`(void|vec3|float)\\s+${name}\\s*\\(`));
    }
  });

  it('keeps the three chunks it patches into', () => {
    const shader = patched();

    expect(shader.vertexShader).toContain('#include <begin_vertex>');
    expect(shader.fragmentShader).toContain('#include <normal_fragment_maps>');
    expect(shader.fragmentShader).toContain('#include <color_fragment>');
  });

  it('mixes the per-letter seed into the cell hash, or every letter sparkles alike', () => {
    const shader = patched();

    expect(shader.vertexShader).toContain('attribute float aSeed');
    expect(shader.vertexShader).toContain('vSeed = aSeed');
    expect(shader.fragmentShader).toContain('vSeed');
  });
});

describe('FlakeUniforms', () => {
  it('names every uniform the shader declares', () => {
    const u: FlakeUniforms = createFlakeUniforms();
    const shader = patched();

    for (const name of Object.keys(u)) {
      expect(shader.fragmentShader, name).toContain(name);
    }
  });
});
