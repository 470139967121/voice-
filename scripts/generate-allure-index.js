#!/usr/bin/env node
/**
 * Generate the Allure landing page (index.html) for GitHub Pages.
 *
 * Reads metadata.json files from gh-pages directory structure:
 *   {suite}/{env}/latest/metadata.json
 *
 * Usage:
 *   node scripts/generate-allure-index.js [gh-pages-dir] [output-file]
 *
 * Defaults:
 *   gh-pages-dir = ./gh-pages
 *   output-file  = ./allure-landing/index.html
 */

const fs = require('node:fs');
const path = require('node:path');

const SUITES = [
  {
    id: 'android-e2e',
    name: 'Android E2E',
    icon: '📱',
    desc: 'Full user journey tests on real Android emulators',
  },
  {
    id: 'playwright',
    name: 'Playwright',
    icon: '🌐',
    desc: 'Admin panel tests across 5 browsers',
  },
  {
    id: 'express',
    name: 'Express',
    icon: '⚡',
    desc: 'API unit tests with Jest coverage reports',
  },
  {
    id: 'kotlin',
    name: 'Kotlin',
    icon: '🟣',
    desc: 'Business logic unit tests (JVM + Android)',
  },
];

const ENVS = ['pr', 'deploy'];

function loadMetadata(ghPagesDir) {
  const metadata = {};
  if (!fs.existsSync(ghPagesDir)) return metadata;

  for (const suite of SUITES) {
    for (const env of ENVS) {
      const metaPath = path.join(ghPagesDir, suite.id, env, 'latest', 'metadata.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (!metadata[suite.id]) metadata[suite.id] = {};
        metadata[suite.id][env] = data;
      } catch {
        // Malformed JSON — skip
      }
    }
  }
  return metadata;
}

function renderBadge(meta) {
  if (!meta) return '<span class="badge no-data">No data yet</span>';
  const color = meta.failed > 0 ? '#e74c3c' : '#27ae60';
  const parts = [];
  if (meta.passed > 0) parts.push(`${meta.passed} passed`);
  if (meta.failed > 0) parts.push(`${meta.failed} failed`);
  return `<span class="badge" style="background:${color}">${parts.join(', ')}</span>
          <span class="meta-date">${meta.date || ''}</span>`;
}

function renderCard(suite, metadata) {
  const suiteMeta = metadata[suite.id] || {};
  return `
    <div class="card">
      <div class="card-icon">${suite.icon}</div>
      <h3>${suite.name}</h3>
      <p class="card-desc">${suite.desc}</p>
      <div class="card-envs">
        <div class="env-row">
          <span class="env-label">PR Checks</span>
          ${renderBadge(suiteMeta.pr)}
          <a href="${suite.id}/pr/latest/" class="btn">View</a>
          <a href="${suite.id}/pr/runs/" class="btn btn-sm">History</a>
        </div>
        <div class="env-row">
          <span class="env-label">Deploy</span>
          ${renderBadge(suiteMeta.deploy)}
          <a href="${suite.id}/deploy/latest/" class="btn">View</a>
          <a href="${suite.id}/deploy/runs/" class="btn btn-sm">History</a>
        </div>
      </div>
    </div>`;
}

function generateHtml(metadata) {
  const cards = SUITES.map((s) => renderCard(s, metadata)).join('\n');
  const now = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShyTalk Test Reports</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #121218;
      color: #e0e0e0;
      min-height: 100vh;
    }
    .hero {
      text-align: center;
      padding: 3rem 1rem 2rem;
    }
    .hero h1 { color: #8b7fff; font-size: 2rem; margin-bottom: 0.5rem; }
    .hero p { color: #999; max-width: 600px; margin: 0 auto; line-height: 1.6; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.5rem;
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1.5rem 2rem;
    }
    .card {
      background: #1a1a2e;
      border-radius: 12px;
      padding: 1.5rem;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover {
      transform: translateY(-3px);
      box-shadow: 0 8px 24px rgba(139, 127, 255, 0.15);
    }
    .card-icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .card h3 { color: #fff; margin-bottom: 0.25rem; }
    .card-desc { color: #888; font-size: 0.85rem; margin-bottom: 1rem; }
    .card-envs { display: flex; flex-direction: column; gap: 0.75rem; }
    .env-row {
      display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
    }
    .env-label {
      font-size: 0.8rem; color: #aaa; min-width: 70px;
    }
    .badge {
      padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;
      color: #fff; font-weight: 600;
    }
    .badge.no-data { background: #555; }
    .meta-date { font-size: 0.7rem; color: #666; }
    .btn {
      padding: 4px 12px; border-radius: 6px; font-size: 0.75rem;
      background: #8b7fff; color: #fff; text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover { background: #7a6ef0; }
    .btn-sm { background: #2a2a3e; }
    .btn-sm:hover { background: #3a3a5e; }
    .guide {
      max-width: 800px; margin: 2rem auto; padding: 0 1.5rem;
    }
    .guide details {
      background: #1a1a2e; border-radius: 12px; padding: 1rem 1.5rem;
    }
    .guide summary {
      cursor: pointer; color: #8b7fff; font-weight: 600; font-size: 1.1rem;
    }
    .guide-content { margin-top: 1rem; line-height: 1.7; color: #bbb; }
    .guide-content h4 { color: #e0e0e0; margin: 1rem 0 0.5rem; }
    .guide-content ul { padding-left: 1.5rem; }
    .guide-content li { margin-bottom: 0.3rem; }
    footer {
      text-align: center; padding: 2rem 1rem; color: #555; font-size: 0.8rem;
    }
    footer a { color: #8b7fff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="hero">
    <h1>ShyTalk Test Reports</h1>
    <p>We run thousands of automated tests across every platform to ensure ShyTalk is reliable, secure, and bug-free. Browse our latest test results below.</p>
  </div>

  <div class="cards">
${cards}
  </div>

  <div class="guide">
    <details>
      <summary>How to read these reports</summary>
      <div class="guide-content">
        <h4>What Allure reports show</h4>
        <p>Each report contains detailed test cases with steps, attachments (screenshots, traces), and trend graphs showing test stability over time.</p>

        <h4>How to navigate</h4>
        <ul>
          <li><strong>Overview</strong> — summary of pass/fail rates and trends</li>
          <li><strong>Suites</strong> — click a test suite to see individual test cases</li>
          <li><strong>Click a test</strong> — see execution steps, screenshots on failure, and timing</li>
        </ul>

        <h4>Status meanings</h4>
        <ul>
          <li><strong>Passed</strong> — test completed successfully</li>
          <li><strong>Failed</strong> — test assertion did not match expected result</li>
          <li><strong>Broken</strong> — test crashed due to an unexpected error (not an assertion)</li>
          <li><strong>Skipped</strong> — test was intentionally skipped</li>
        </ul>

        <h4>What each suite covers</h4>
        <ul>
          <li><strong>Android E2E</strong> — full user journeys on real Android emulators (BDD/Gherkin)</li>
          <li><strong>Playwright</strong> — admin panel web tests across Chromium, Firefox, WebKit, mobile Chrome, mobile Safari</li>
          <li><strong>Express</strong> — API endpoint unit tests with code coverage</li>
          <li><strong>Kotlin</strong> — shared business logic, ViewModels, repositories</li>
        </ul>
      </div>
    </details>
  </div>

  <footer>
    Powered by <a href="https://allurereport.org/" target="_blank" rel="noopener">Allure Framework</a>
    &middot; <a href="https://shytalk.shyden.co.uk" target="_blank" rel="noopener">ShyTalk</a>
    &middot; Last updated: ${now}
  </footer>
</body>
</html>`;
}

// CLI mode
if (require.main === module) {
  const ghPagesDir = process.argv[2] || './gh-pages';
  const outputFile = process.argv[3] || './allure-landing/index.html';

  const metadata = loadMetadata(ghPagesDir);
  const html = generateHtml(metadata);

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, html);
  console.log(`Landing page generated: ${outputFile}`);
}

// Export for testing
module.exports = generateHtml;
module.exports.loadMetadata = loadMetadata;
module.exports.generateHtml = generateHtml;
