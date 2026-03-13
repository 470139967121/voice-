import { test, expect } from '@playwright/test';

test.describe('Privacy Policy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/privacy.html');
  });

  test('loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Privacy/i);
  });

  test('has viewport meta tag', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('contains key privacy sections', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('Information We Collect');
    await expect(body).toContainText('Data Storage');
  });

});

test.describe('Terms of Service', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/terms.html');
  });

  test('loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Terms/i);
  });

  test('has viewport meta tag', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('contains key terms sections', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('Terms of Service');
    await expect(body).toContainText('Acceptable Use');
  });

});

test.describe('Community Guidelines', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/community-guidelines.html');
  });

  test('loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Community/i);
  });

  test('has viewport meta tag', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('contains community-related content', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('Community Guidelines');
    await expect(body).toContainText('Be Respectful');
  });

});

test.describe('Cyber Bullying Policy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cyber-bullying.html');
  });

  test('loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Cyber Bullying/i);
  });

  test('has viewport meta tag', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('contains anti-bullying content', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('bullying');
  });

});

test.describe('Consistent styling across pages', () => {
  const pages = ['/privacy.html', '/terms.html', '/community-guidelines.html', '/cyber-bullying.html'];

  for (const pagePath of pages) {
    test(`${pagePath} uses dark theme`, async ({ page }) => {
      await page.goto(pagePath);
      const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      // All pages use the dark theme (--bg: #0f0d15) which is rgb(15, 13, 21)
      expect(bgColor).not.toBe('rgb(255, 255, 255)');
    });
  }
});
