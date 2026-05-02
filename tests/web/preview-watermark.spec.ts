import { test, expect } from '@playwright/test';

/**
 * TDD contract for the web watermark (`public/js/preview-watermark.js`):
 *
 * 1. The watermark element (`#preview-watermark`) MUST be present on
 *    every public page when the page is served from a non-prod host
 *    (localhost, dev API). It MUST contain the literal string
 *    "ShyTalk Preview".
 * 2. The watermark MUST display the detected environment, build/release
 *    indicator, browser identification, and the signed-in user's UID
 *    (or "-" when not signed in).
 * 3. On a prod host (mocked via host header / hostname), the watermark
 *    element MUST NOT exist — false-positive watermarks on real prod
 *    erode trust in the signal.
 *
 * The Playwright suite runs against the local web server, so by default
 * every test exercises the non-prod path. The "prod hides watermark"
 * test mocks env detection by overriding the watermark module's
 * `getEnvironment()` via a `window.__preview_env_override` hook before
 * the script runs.
 */

const PAGES = [
  '/',
  '/admin/',
  '/portal/',
  '/roadmap.html',
  '/privacy.html',
  '/terms.html',
  '/community-guidelines.html',
  '/cyber-bullying.html',
];

test.describe('Preview watermark — visibility on non-prod hosts', () => {
  for (const page of PAGES) {
    test(`shows on ${page}`, async ({ page: browser }) => {
      await browser.goto(page);
      const watermark = browser.locator('#preview-watermark');
      await expect(watermark).toBeVisible();
      await expect(watermark).toContainText('ShyTalk Preview');
    });
  }
});

test.describe('Preview watermark — content', () => {
  test('displays environment label', async ({ page }) => {
    await page.goto('/');
    const watermark = page.locator('#preview-watermark');
    // "local" because Playwright runs against http://localhost:8888
    await expect(watermark).toContainText(/local|dev/i);
  });

  test('displays browser identification', async ({ page }) => {
    await page.goto('/');
    const watermark = page.locator('#preview-watermark');
    // Browser engine should appear in the badge — Chromium / Firefox /
    // WebKit. The watermark module derives this from the User-Agent.
    const text = await watermark.textContent();
    expect(text).toMatch(/Chromium|Chrome|Firefox|WebKit|Safari/i);
  });

  test('displays UID with - placeholder when not signed in', async ({ page }) => {
    await page.goto('/');
    const watermark = page.locator('#preview-watermark');
    await expect(watermark).toContainText(/UID:\s*[-\d]/);
  });
});

test.describe('Preview watermark — production opt-out', () => {
  test('not rendered when env override is "prod"', async ({ page }) => {
    // Override the watermark module's environment detection BEFORE the
    // page script runs. The module reads `window.__preview_env_override`
    // first; if it's set, that value wins over hostname-based detection.
    await page.addInitScript(() => {
      (window as any).__preview_env_override = 'prod';
    });
    await page.goto('/');
    await expect(page.locator('#preview-watermark')).toHaveCount(0);
  });
});

test.describe('Preview watermark — overlay does not break the page', () => {
  test('main page content renders alongside watermark', async ({ page }) => {
    await page.goto('/');
    // Body should still contain whatever main-page content the
    // unmodified landing page renders. Specifically check that the
    // <main> or <body> still has text — i.e. the watermark isn't
    // covering or replacing the page.
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.length || 0).toBeGreaterThan(50);
  });
});
