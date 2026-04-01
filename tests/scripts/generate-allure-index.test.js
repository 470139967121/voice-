/**
 * Tests for generate-allure-index.js — Allure landing page generator.
 *
 * Covers:
 * - HTML generation with metadata
 * - Missing metadata handled gracefully
 * - Suite card rendering for each test suite
 * - Report links use correct paths
 * - Dark theme CSS present
 * - "How to read" section present
 * - Footer with timestamp
 * - PII-free output
 */

const fs = require('node:fs');
const path = require('node:path');

// The script exports a generateHtml function for testing
let generateHtml;

beforeAll(() => {
  generateHtml = require('../../scripts/generate-allure-index');
});

describe('generateHtml', () => {
  test('returns valid HTML with doctype', () => {
    const html = generateHtml({});
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('</html>');
  });

  test('includes ShyTalk branding', () => {
    const html = generateHtml({});
    expect(html).toContain('ShyTalk');
    expect(html).toContain('Test Reports');
  });

  test('includes dark theme colors', () => {
    const html = generateHtml({});
    expect(html).toContain('#121218');
    expect(html).toContain('#1a1a2e');
    expect(html).toContain('#8b7fff');
  });

  test('renders all five suite cards', () => {
    const html = generateHtml({});
    expect(html).toContain('Android E2E');
    expect(html).toContain('Playwright');
    expect(html).toContain('Express');
    expect(html).toContain('Kotlin');
    expect(html).toContain('iOS E2E');
  });

  test('renders metadata when available', () => {
    const metadata = {
      'android-e2e': {
        pr: { passed: 140, failed: 1, total: 141, date: '2026-03-31' },
      },
    };
    const html = generateHtml(metadata);
    expect(html).toContain('140');
    expect(html).toContain('2026-03-31');
  });

  test('shows "No data" when metadata is missing for a suite', () => {
    const html = generateHtml({});
    expect(html).toContain('No data yet');
  });

  test('includes PR and Deploy links for each suite', () => {
    const html = generateHtml({});
    expect(html).toContain('android-e2e/pr/latest/');
    expect(html).toContain('android-e2e/deploy/latest/');
    expect(html).toContain('playwright/pr/latest/');
    expect(html).toContain('playwright/deploy/latest/');
    expect(html).toContain('express/pr/latest/');
    expect(html).toContain('kotlin/pr/latest/');
  });

  test('includes history links', () => {
    const html = generateHtml({});
    expect(html).toContain('android-e2e/pr/runs/');
    expect(html).toContain('playwright/deploy/runs/');
  });

  test('includes "How to read" section', () => {
    const html = generateHtml({});
    expect(html).toContain('How to read these reports');
  });

  test('includes footer with Allure Framework credit', () => {
    const html = generateHtml({});
    expect(html).toContain('Allure Framework');
  });

  test('is responsive (includes viewport meta tag)', () => {
    const html = generateHtml({});
    expect(html).toContain('viewport');
    expect(html).toContain('width=device-width');
  });

  test('does not contain PII', () => {
    const metadata = {
      'android-e2e': {
        pr: { passed: 100, failed: 0, total: 100, date: '2026-03-31' },
      },
    };
    const html = generateHtml(metadata);
    expect(html).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    expect(html).not.toMatch(/eyJ[A-Za-z0-9_-]+\.eyJ/);
  });

  test('renders pass/fail badge correctly', () => {
    const metadata = {
      playwright: {
        deploy: { passed: 50, failed: 0, total: 50, date: '2026-03-31' },
      },
    };
    const html = generateHtml(metadata);
    expect(html).toContain('50 passed');
  });

  test('renders failure count when tests fail', () => {
    const metadata = {
      playwright: {
        pr: { passed: 48, failed: 2, total: 50, date: '2026-03-31' },
      },
    };
    const html = generateHtml(metadata);
    expect(html).toContain('2 failed');
  });
});

describe('loadMetadata', () => {
  let loadMetadata;

  beforeAll(() => {
    loadMetadata = require('../../scripts/generate-allure-index').loadMetadata;
  });

  test('returns empty object when gh-pages dir does not exist', () => {
    const result = loadMetadata('/nonexistent/path');
    expect(result).toEqual({});
  });

  test('reads metadata.json from suite/env/latest/', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'allure-test-'));
    const metaDir = path.join(tmpDir, 'android-e2e', 'pr', 'latest');
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(metaDir, 'metadata.json'),
      JSON.stringify({ passed: 10, failed: 1, total: 11, date: '2026-01-01' }),
    );

    const result = loadMetadata(tmpDir);
    expect(result['android-e2e']).toBeDefined();
    expect(result['android-e2e'].pr.passed).toBe(10);
    expect(result['android-e2e'].pr.failed).toBe(1);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('handles malformed metadata.json gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'allure-test-'));
    const metaDir = path.join(tmpDir, 'express', 'deploy', 'latest');
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, 'metadata.json'), 'not json');

    const result = loadMetadata(tmpDir);
    expect(result.express).toBeUndefined();

    fs.rmSync(tmpDir, { recursive: true });
  });
});
