import { expect, type Page, test } from '@playwright/test';

/**
 * Appearance is the one thing the unit suite cannot reach: vitest has no GL context, so the
 * flake shader is pinned here or nowhere.
 *
 * Baselines are per-platform and these run locally, not in CI — `npm run check` is what CI
 * gates on. Regenerate after an intentional look change with `npm run test:visual -- -u`.
 */
// The stage renders at min(devicePixelRatio, 2), so a 1x baseline would show flakes at twice
// the size anyone actually sees them.
test.use({ deviceScaleFactor: 2 });

const LOOKS = [
  'gold',
  'chrome',
  'oil',
  'gem',
  'velvet',
  'neon',
  'flake',
  'glitter',
  'leather',
] as const;

/** Every source of frame-to-frame variation off, so a screenshot is a function of the look. */
async function still(page: Page): Promise<void> {
  await page.goto('/');
  await page.fill('#text', 'JACKPOT!');
  await page.fill('#hold', '8000');
  await page.fill('#blend', '0');
  await page.selectOption('#enter', 'none');
  await page.selectOption('#active', 'none');
  await page.selectOption('#exit', 'none');
  await page.selectOption('#lighting', 'static');
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.click('#fire');
  // The first frame draws on the next rAF after the font resolves; a beat covers both.
  await page.waitForTimeout(600);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    // The log stamps wall-clock times, which would differ on every run.
    mask: [page.locator('#log')],
    // WebGL is not bit-exact across driver versions; this still catches a look going wrong.
    maxDiffPixelRatio: 0.02,
  });
}

test.describe('looks', () => {
  for (const look of LOOKS) {
    test(look, async ({ page }) => {
      await still(page);
      await page.selectOption('#look', look);
      await shoot(page, `look-${look}`);
    });
  }
});

test.describe('lighting', () => {
  test('static holds the highlight where sweep moves it', async ({ page }) => {
    await still(page);
    await page.selectOption('#look', 'chrome');
    await shoot(page, 'lighting-static');
  });
});

test.describe('flake seeding', () => {
  test('repeated letters do not sparkle in lockstep', async ({ page }) => {
    await still(page);
    await page.selectOption('#look', 'glitter');
    // Four identical letters: an identical flake field across them is the failure this catches.
    await page.fill('#text', 'MMMM');
    await shoot(page, 'flake-seeding');
  });
});
