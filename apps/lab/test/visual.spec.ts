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

/**
 * Number of separated horizontal bands of lit rows. Counting bands rather than pixels is what
 * makes this independent of the fitted scale: a block that wraps to two lines shrinks to stay
 * inside the budget, so it does not reliably light more pixels than one line does.
 */
function litBands(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return reject(new Error('the overlay never created a canvas'));
        const gl = canvas.getContext('webgl2');
        if (!gl) return reject(new Error('the overlay canvas has no webgl2 context'));

        const { width, height } = canvas;
        const px = new Uint8Array(width * height * 4);

        // Inside rAF, after the library's own draw: the buffer is not preserveDrawingBuffer, so
        // reading it any later returns a cleared frame and every band census comes back zero.
        requestAnimationFrame(() => {
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);

          let bands = 0;
          let inBand = false;
          for (let y = 0; y < height; y++) {
            let lit = false;
            for (let x = 0; x < width && !lit; x++) {
              if (px[(y * width + x) * 4 + 3] !== 0) lit = true;
            }
            if (lit && !inBand) bands++;
            inBand = lit;
          }
          resolve(bands);
        });
      }),
  );
}

/** Holds a still, fully-arrived word so the band census is not sampled mid-flight. */
async function fireStill(page: Page, text: string): Promise<void> {
  await page.goto('/');
  await page.locator('#enter').selectOption('none');
  await page.locator('#active').selectOption('none');
  await page.locator('#hold').fill('4000');
  await page.locator('#text').fill(text);
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();
  await page.waitForTimeout(200);
}

test('a two-line block draws a second row of letters', async ({ page }) => {
  await fireStill(page, 'BIG');
  expect(await litBands(page)).toBe(1);

  await fireStill(page, 'BIG\nMONEY');
  expect(await litBands(page)).toBe(2);
});

test('wrap breaks a long line into rows, and leaves it alone unchecked', async ({ page }) => {
  await fireStill(page, 'BIG MONEY PRIZE');
  expect(await litBands(page)).toBe(1);

  await page.goto('/');
  await page.locator('#enter').selectOption('none');
  await page.locator('#active').selectOption('none');
  await page.locator('#hold').fill('4000');
  await page.locator('#wrap').check();
  await page.locator('#text').fill('BIG MONEY PRIZE');
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();
  await page.waitForTimeout(200);

  expect(await litBands(page)).toBeGreaterThan(1);
});

test('an effect held until click stays up, and the click dismisses it', async ({ page }) => {
  await page.goto('/');
  await page.locator('#holdClick').check();
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();

  // Far past the 1200ms default hold: a held effect has no timeout to reach.
  await page.waitForTimeout(3000);
  expect((await readOverlay(page, 4)).drawn).toBeGreaterThan(0);
  await expect(page.locator('#log')).not.toContainText('done');

  await page.mouse.click(400, 500);
  await expect(page.locator('#log')).toContainText('done');
});

test('the dismissing click still reaches the page when the hold is not modal', async ({ page }) => {
  await page.goto('/');
  await page.locator('#holdClick').check();
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();
  await page.waitForTimeout(500);

  // One click on FIRE: it dismisses the held effect and presses the button underneath.
  await page.getByRole('button', { name: 'FIRE', exact: true }).click({ timeout: 5000 });

  await expect(page.locator('#log')).toContainText('done');
  expect((await page.locator('#log').innerText()).match(/fire /g)?.length).toBe(2);
});

test('the overlay does not intercept clicks meant for the page beneath it', async ({ page }) => {
  await fire(page, { bloom: false });
  // The canvas covers the panel at z-index 2147483000, so this second click only reaches the
  // button if pointer-events:none holds; without it Playwright times out on the action itself.
  await page.locator('#text').fill('SECOND');
  await page.getByRole('button', { name: 'FIRE', exact: true }).click({ timeout: 5000 });
  await expect(page.locator('#log')).toContainText('fire "SECOND"');
});
