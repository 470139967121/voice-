import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web',
  testIgnore: ['**/auth.setup.ts'],
  timeout: 60_000,
  retries: 1,
  workers: 1, // Serial — Firebase Auth rate-limits concurrent logins
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'playwright-results.xml' }],
  ],
  use: {
    baseURL: process.env.WEB_BASE_URL || 'https://dev.shytalk.shyden.co.uk',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
