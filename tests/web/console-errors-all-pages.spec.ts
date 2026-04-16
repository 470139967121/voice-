import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Console error checks for EVERY public web page.
 * Each page must load with zero console errors.
 * Warnings are also captured for review.
 */
test.describe('Console Errors — All Pages', () => {
  const pages = [
    { name: 'Landing', path: '/' },
    { name: 'Roadmap', path: '/roadmap.html' },
    { name: 'Privacy Policy', path: '/privacy.html' },
    { name: 'Terms of Service', path: '/terms.html' },
    { name: 'Community Guidelines', path: '/community-guidelines.html' },
    { name: 'Cyber Bullying Policy', path: '/cyber-bullying.html' },
    { name: 'Portal', path: '/portal/' },
    { name: 'Khmer New Year', path: '/events/khmer-new-year.html' },
  ];

  for (const { name, path } of pages) {
    test(`${name} page loads with zero console errors`, async ({ page }) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
        if (msg.type() === 'warning') warnings.push(msg.text());
      });

      await page.goto(`${BASE}${path}`);
      await page.waitForTimeout(2_000);

      // Filter benign errors (browser extensions, third-party scripts)
      const realErrors = errors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('ERR_CONNECTION_REFUSED') &&
        !e.includes('net::ERR_') &&
        !e.includes('Failed to load resource') // Firebase config may fail in test env
      );

      if (realErrors.length > 0) {
        console.log(`Console errors on ${name}:`, realErrors);
      }
      expect(realErrors).toHaveLength(0);
    });
  }
});
