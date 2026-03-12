import { test, expect } from '@playwright/test';

test.describe('Admin Panel', () => {
  test('loads login page', async ({ page }) => {
    await page.goto('/admin/');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('shows correct API endpoint', async ({ page }) => {
    await page.goto('/admin/');
    const apiBase = await page.evaluate(() => (window as any).SHYTALK_CONFIG?.API_BASE);
    expect(apiBase).toBeTruthy();
    expect(apiBase).toContain('shytalk.shyden.co.uk');
  });
});
