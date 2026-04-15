import { test, expect } from '@playwright/test';

/**
 * Dev deployment sanity checks — lightweight verification that services
 * are up and pages load after deployment. NOT a full test suite.
 *
 * Used by deploy-dev.yml instead of the full Playwright matrix.
 */

const WEB_BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';

test.describe('Dev Sanity Checks', () => {

  test('landing page loads', async ({ page }) => {
    const res = await page.goto(WEB_BASE);
    expect(res?.ok()).toBe(true);
    await expect(page.locator('.logo')).toBeVisible({ timeout: 10_000 });
  });

  test('roadmap page loads with data', async ({ page }) => {
    await page.goto(`${WEB_BASE}/roadmap.html`);
    // Wait for roadmap items to render (fetched from roadmap-data.json)
    await expect(page.locator('.phase-card, .roadmap-phase')).not.toHaveCount(0, { timeout: 15_000 });
  });

  test('admin panel loads', async ({ page }) => {
    const res = await page.goto(`${WEB_BASE}/admin/`);
    expect(res?.ok()).toBe(true);
    // Should show login or dashboard
    await expect(page.locator('#login-screen, #dashboard-screen')).not.toHaveCount(0, { timeout: 10_000 });
  });

  test('portal loads', async ({ page }) => {
    const res = await page.goto(`${WEB_BASE}/portal/`);
    expect(res?.ok()).toBe(true);
  });

  test('events.json is accessible', async ({ page }) => {
    const res = await page.request.get(`${WEB_BASE}/events/events.json`);
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('events');
  });

  test('API health endpoint responds', async ({ page }) => {
    // Skip if API isn't running (pre-push hook runs without full local stack)
    const probe = await page.request.get(`${API_BASE}/api/health`).catch(() => null);
    test.skip(!probe, 'API not running — skipping API tests');
    expect(probe!.ok()).toBe(true);
  });

  test('API firebase-config responds', async ({ page }) => {
    const probe = await page.request.get(`${API_BASE}/api/firebase-config`).catch(() => null);
    test.skip(!probe, 'API not running — skipping API tests');
    expect(probe!.ok()).toBe(true);
    const data = await probe!.json();
    expect(data).toHaveProperty('apiKey');
    expect(data).toHaveProperty('projectId');
  });

  test('no console errors on landing page', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto(WEB_BASE);
    await page.waitForTimeout(2_000);
    expect(errors).toHaveLength(0);
  });
});
