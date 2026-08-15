import { expect, type Page, test } from '@playwright/test';

/** Alpha census of one frame of the overlay's drawing buffer. */
interface Frame {
  lit: number;
  clear: number;
  total: number;
}

interface Reading {
  frames: number;
  drawn: number;
  best: Frame;
}

const SAMPLE_FRAMES = 24;

/**
 * Reports the busiest of `frames` consecutive frames of the overlay's own drawing buffer.
 *
 * `readPixels` after the effect settles returns zeros — the buffer is not `preserveDrawingBuffer`,
 * so it is cleared once the page composites. Reading from `requestAnimationFrame`, which runs
 * after the library's own rAF-driven draw, is the only way to see what the overlay put on screen.
 */
function readOverlay(page: Page, frames: number): Promise<Reading> {
  return page.evaluate(
    (count) =>
      new Promise<Reading>((resolve, reject) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return reject(new Error('the overlay never created a canvas'));
        const gl = canvas.getContext('webgl2');
        if (!gl) return reject(new Error('the overlay canvas has no webgl2 context'));

        const { width, height } = canvas;
        const px = new Uint8Array(width * height * 4);
        const total = width * height;
        let sampled = 0;
        let drawn = 0;
        let best: Frame = { lit: 0, clear: total, total };

        const step = () => {
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let lit = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) lit++;

          sampled++;
          if (lit > 0) drawn++;
          if (lit > best.lit) best = { lit, clear: total - lit, total };

          if (sampled < count) requestAnimationFrame(step);
          else resolve({ frames: sampled, drawn, best });
        };
        requestAnimationFrame(step);
      }),
    frames,
  );
}

/** Fires one long-held effect and returns once its canvas is on the page. */
async function fire(page: Page, options: { bloom: boolean }): Promise<void> {
  await page.goto('/');
  // Long enough that the sampler, slowed by a full-buffer readPixels per frame, stays inside it.
  await page.locator('#hold').fill('4000');
  if (options.bloom) await page.locator('#bloom').check();
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();
}

function expectTransparentOverlay(reading: Reading): void {
  expect(
    reading.drawn,
    `not one of ${reading.frames} sampled frames held a non-transparent pixel: either the letters never drew, or the sampler never caught a live draw and the check below proves nothing`,
  ).toBeGreaterThan(0);
  expect(
    reading.best.clear,
    `the overlay composited as an opaque rectangle: ${reading.best.lit} of ${reading.best.total} pixels are non-transparent`,
  ).toBeGreaterThan(reading.best.lit);
}

test('the direct path lights the letters and leaves the rest of the overlay transparent', async ({
  page,
}) => {
  await fire(page, { bloom: false });
  expectTransparentOverlay(await readOverlay(page, SAMPLE_FRAMES));
});

// The composite shader computes the glow's alpha as max(base.a, luma * alphaBoost), which is the
// likeliest place for the whole canvas to go opaque. The direct path never runs that shader.
test('the bloom path lights the letters and leaves the rest of the overlay transparent', async ({
  page,
}) => {
  await fire(page, { bloom: true });
  expectTransparentOverlay(await readOverlay(page, SAMPLE_FRAMES));
});

test('the overlay does not intercept clicks meant for the page beneath it', async ({ page }) => {
  await fire(page, { bloom: false });
  // The canvas covers the panel at z-index 2147483000, so this second click only reaches the
  // button if pointer-events:none holds; without it Playwright times out on the action itself.
  await page.locator('#text').fill('SECOND');
  await page.getByRole('button', { name: 'FIRE', exact: true }).click({ timeout: 5000 });
  await expect(page.locator('#log')).toContainText('fire "SECOND"');
});
