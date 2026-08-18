/**
 * Does one MeshPhysicalMaterial per letter cost measurably more than one shared across the word?
 *
 *   node spikes/per-letter-materials.mjs
 *
 * Reports CPU ms spent inside renderer.render() per frame, and the compiled program count —
 * the decoration-layer design claims N materials still compile one program, because three's
 * default cache key is onBeforeCompile.toString() and every letter injects identical source.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    return;
  }
  const file = path.join(root, url);
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const PAGE = `<!doctype html><meta charset=utf8><body style="margin:0">
<script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';

// A glyph-shaped proxy: extruded outline with a counter, bevelled, at the same segment counts
// DEFAULT_GLYPH_OPTIONS uses. The variable under test is materials, not geometry.
function glyphish() {
  const s = new THREE.Shape();
  s.moveTo(-0.35, -0.5); s.lineTo(0.35, -0.5); s.lineTo(0.35, 0.5); s.lineTo(-0.35, 0.5);
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.18, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return new THREE.ExtrudeGeometry([s], {
    depth: 0.3, bevelEnabled: true, bevelThickness: 0.055, bevelSize: 0.038,
    bevelSegments: 5, curveSegments: 10,
  });
}

// Mirrors createMaterial(): each material owns its uniforms and captures them in its own
// onBeforeCompile closure. Identical source text across letters is what should dedupe.
function makeMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ envMapIntensity: 2.2, transparent: true });
  const uniforms = { uSeed: { value: 0 }, uFlakeDensity: { value: 0.5 } };
  m.userData.flake = uniforms;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSeed = uniforms.uSeed;
    shader.uniforms.uFlakeDensity = uniforms.uFlakeDensity;
    shader.fragmentShader = 'uniform float uSeed, uFlakeDensity;\\n' + shader.fragmentShader;
  };
  return m;
}

window.bench = async (letters, mode, frames, warmup) => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: false });
  renderer.setSize(800, 600, false);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2, 3, 4);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 100);
  camera.position.z = letters * 0.5 + 4;

  const geo = glyphish();
  const shared = mode === 'shared' ? makeMaterial() : null;
  const materials = [];
  const groups = [];
  for (let i = 0; i < letters; i++) {
    const mat = shared ?? makeMaterial();
    if (!shared) materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    // The decorated case wraps each letter in a Group, so pay that matrix cost here too.
    const group = new THREE.Group();
    group.position.x = (i - (letters - 1) / 2) * 0.8;
    group.add(mesh);
    scene.add(group);
    groups.push(group);
  }

  const tick = (n) => {
    for (let i = 0; i < groups.length; i++) {
      groups[i].rotation.y = n * 0.01 + i;
      const mat = shared ?? materials[i];
      mat.opacity = 0.5 + 0.5 * Math.sin(n * 0.05 + i);
    }
  };
  const frame = () => new Promise((r) => requestAnimationFrame(r));

  for (let n = 0; n < warmup; n++) { tick(n); renderer.render(scene, camera); await frame(); }

  let cpu = 0;
  for (let n = 0; n < frames; n++) {
    tick(n);
    const t0 = performance.now();
    renderer.render(scene, camera);
    cpu += performance.now() - t0;
    await frame();
  }

  const programs = renderer.info.programs.length;
  const verts = geo.attributes.position.count;
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const device = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

  renderer.dispose(); geo.dispose();
  if (shared) shared.dispose(); else for (const m of materials) m.dispose();
  canvas.remove();

  return { ms: cpu / frames, programs, verts, device };
};
</script></body>`;

const FRAMES = Number(process.env.FRAMES ?? 120);
const WARMUP = Number(process.env.WARMUP ?? 30);
const CASES = [];
for (const letters of [1, 13, 50]) for (const mode of ['shared', 'perLetter']) CASES.push({ letters, mode });

await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// Headless Chromium falls back to SwiftShader; HEADED=1 gets the real GPU via ANGLE/Metal.
const browser = await chromium.launch({ headless: !process.env.HEADED });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => typeof window.bench === 'function');

console.log(`${FRAMES} measured frames after ${WARMUP} warmup, CPU ms inside renderer.render()\n`);

const results = [];
for (let i = 0; i < CASES.length; i++) {
  const { letters, mode } = CASES[i];
  const r = await page.evaluate(
    ([l, m, f, w]) => window.bench(l, m, f, w),
    [letters, mode, FRAMES, WARMUP],
  );
  results.push({ letters, mode, ...r });
  console.log(
    `${i + 1}/${CASES.length}  ${mode.padEnd(9)} ${String(letters).padStart(2)} letters  ` +
      `${r.ms.toFixed(4)} ms/frame   ${r.programs} program(s)`,
  );
}

console.log(`\ndevice: ${results[0].device}`);
console.log(`glyph proxy: ${results[0].verts} vertices\n`);
for (const letters of [1, 13, 50]) {
  const s = results.find((r) => r.letters === letters && r.mode === 'shared');
  const p = results.find((r) => r.letters === letters && r.mode === 'perLetter');
  const delta = p.ms - s.ms;
  console.log(
    `${String(letters).padStart(2)} letters: +${delta.toFixed(4)} ms/frame ` +
      `(${((delta / s.ms) * 100).toFixed(0)}% over shared), ` +
      `programs ${s.programs} -> ${p.programs}`,
  );
}

await browser.close();
server.close();
