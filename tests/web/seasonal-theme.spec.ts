import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

test.describe('Seasonal Theme System', () => {
  test('seasonal-theme.js loads without errors on landing page', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto(BASE);
    await page.waitForTimeout(1_000);
    expect(errors.filter(e => e.includes('seasonal'))).toHaveLength(0);
  });

  test('events.json is fetchable and valid JSON', async ({ page }) => {
    const response = await page.request.get(`${BASE}/events/events.json`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('events');
    expect(Array.isArray(data.events)).toBe(true);
  });

  test('seasonal ribbon appears when event is active', async ({ page }) => {
    await page.addInitScript(() => {
      const RealDate = Date;
      class MockDate extends RealDate {
        constructor(...args: any[]) {
          if (args.length === 0) super(2026, 3, 14, 12, 0, 0);
          else super(...(args as [any]));
        }
        static now() { return new MockDate().getTime(); }
      }
      (globalThis as any).Date = MockDate;
    });
    await page.goto(BASE);
    const ribbon = page.locator('#seasonal-ribbon');
    await expect(ribbon).toBeVisible({ timeout: 5_000 });
    await expect(ribbon).toContainText('Khmer New Year');
  });

  test('seasonal ribbon does NOT appear outside event dates', async ({ page }) => {
    await page.addInitScript(() => {
      const RealDate = Date;
      class MockDate extends RealDate {
        constructor(...args: any[]) {
          if (args.length === 0) super(2026, 0, 15, 12, 0, 0);
          else super(...(args as [any]));
        }
        static now() { return new MockDate().getTime(); }
      }
      (globalThis as any).Date = MockDate;
    });
    await page.goto(BASE);
    await page.waitForTimeout(2_000);
    await expect(page.locator('#seasonal-ribbon')).not.toBeVisible();
  });

  test('seasonal ribbon is dismissible', async ({ page }) => {
    await page.addInitScript(() => {
      const RealDate = Date;
      class MockDate extends RealDate {
        constructor(...args: any[]) {
          if (args.length === 0) super(2026, 3, 14, 12, 0, 0);
          else super(...(args as [any]));
        }
        static now() { return new MockDate().getTime(); }
      }
      (globalThis as any).Date = MockDate;
    });
    await page.goto(BASE);
    const ribbon = page.locator('#seasonal-ribbon');
    await expect(ribbon).toBeVisible({ timeout: 5_000 });
    await ribbon.locator('.seasonal-ribbon-close').click();
    await expect(ribbon).not.toBeVisible();
  });

  test('CSS variables are overridden during active event', async ({ page }) => {
    await page.addInitScript(() => {
      const RealDate = Date;
      class MockDate extends RealDate {
        constructor(...args: any[]) {
          if (args.length === 0) super(2026, 3, 14, 12, 0, 0);
          else super(...(args as [any]));
        }
        static now() { return new MockDate().getTime(); }
      }
      (globalThis as any).Date = MockDate;
    });
    await page.goto(BASE);
    await page.waitForTimeout(2_000);
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
    );
    expect(primary).toBe('#d4a017');
  });

  test('CSS variables remain default outside event dates', async ({ page }) => {
    await page.addInitScript(() => {
      const RealDate = Date;
      class MockDate extends RealDate {
        constructor(...args: any[]) {
          if (args.length === 0) super(2026, 0, 15, 12, 0, 0);
          else super(...(args as [any]));
        }
        static now() { return new MockDate().getTime(); }
      }
      (globalThis as any).Date = MockDate;
    });
    await page.goto(BASE);
    await page.waitForTimeout(2_000);
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
    );
    expect(primary).not.toBe('#d4a017');
  });
});
