import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('loads and displays app name', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ShyTalk/i);
  });

  test('has download link', async ({ page }) => {
    await page.goto('/');
    const playStoreLink = page.locator('a[href*="play.google.com"]');
    await expect(playStoreLink).toBeVisible();
  });
});
