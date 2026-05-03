/**
 * Tests for the Allure landing page generator.
 *
 * The generator renders gh-pages/index.html from a registry JSON
 * (scripts/allure-suites.json) so adding a new test suite (e.g. when a
 * future workflow starts publishing allure-results-* artifacts) is a
 * single-entry registry append rather than a separate PR to edit the
 * static HTML. Existing static-HTML drift was caught when iOS E2E was
 * added in commit 256921b329 — its landing card had to be hand-edited
 * after the fact.
 *
 * The generator is a pure function over the registry, so the tests
 * pass it inline registry fixtures rather than spinning up the real
 * file system.
 */

const { renderLanding, renderSuiteCard } = require('../../../scripts/generate-allure-landing');

describe('renderSuiteCard', () => {
  const sampleSuite = {
    slug: 'android-e2e',
    displayName: 'Android E2E',
    icon: '📱',
    description: 'Full user journey tests on real Android emulators',
  };

  test('embeds the slug into all four navigation links so URLs survive a slug rename via registry edit alone', () => {
    const html = renderSuiteCard(sampleSuite);
    expect(html).toContain('href="android-e2e/pr/latest/"');
    expect(html).toContain('href="android-e2e/pr/runs/"');
    expect(html).toContain('href="android-e2e/deploy/latest/"');
    expect(html).toContain('href="android-e2e/deploy/runs/"');
  });

  test('renders displayName as the card heading', () => {
    const html = renderSuiteCard(sampleSuite);
    // `<h3>` is the canonical card-title element in the existing static
    // landing — pin it so a future CSS refactor doesn't accidentally
    // demote the heading level (a11y / heading-order regression).
    expect(html).toMatch(/<h3>Android E2E<\/h3>/);
  });

  test('renders the icon emoji verbatim', () => {
    const html = renderSuiteCard(sampleSuite);
    expect(html).toContain('📱');
  });

  test('renders the description text', () => {
    const html = renderSuiteCard(sampleSuite);
    expect(html).toContain('Full user journey tests on real Android emulators');
  });

  test('escapes HTML special characters in displayName so a malformed registry entry cannot inject markup', () => {
    // Defensive: registry is hand-edited but a typo or copy-paste from
    // documentation could include `<` / `&` characters. Render must
    // entity-encode rather than blindly interpolate.
    const html = renderSuiteCard({
      slug: 'evil',
      displayName: '<script>alert(1)</script>',
      icon: '⚠️',
      description: 'x',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('escapes HTML special characters in description', () => {
    const html = renderSuiteCard({
      slug: 'evil',
      displayName: 'X',
      icon: '⚠️',
      description: 'a & b <c>',
    });
    expect(html).toContain('a &amp; b &lt;c&gt;');
  });
});

describe('renderLanding', () => {
  const minimalRegistry = {
    suites: [
      {
        slug: 'android-e2e',
        displayName: 'Android E2E',
        icon: '📱',
        description: 'Full user journey tests on real Android emulators',
      },
      {
        slug: 'playwright',
        displayName: 'Playwright',
        icon: '🌐',
        description: 'Admin panel tests across 5 browsers',
      },
    ],
  };

  test('includes a card per suite in the registry', () => {
    const html = renderLanding(minimalRegistry);
    expect(html).toContain('android-e2e/pr/latest/');
    expect(html).toContain('playwright/pr/latest/');
    // Matches the heading per suite — confirms order doesn't drop a card.
    expect(html.match(/<h3>/g)).toHaveLength(minimalRegistry.suites.length);
  });

  test('produces valid HTML5 with doctype, head, and body sections', () => {
    const html = renderLanding(minimalRegistry);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
    expect(html.trim().endsWith('</html>')).toBe(true);
  });

  test('renders the hero copy that sets context for non-developer readers', () => {
    // The landing is linked from the public README and the website
    // footer — the hero text is what convinces non-technical visitors
    // (e.g. App Store reviewers) that we have a serious test culture.
    // Pinning it so a future refactor doesn't accidentally drop it.
    const html = renderLanding(minimalRegistry);
    expect(html).toContain('ShyTalk Test Reports');
    expect(html).toMatch(/thousands of automated tests/i);
  });

  test('renders the "How to read these reports" disclosure for first-time visitors', () => {
    const html = renderLanding(minimalRegistry);
    // The collapsible guide block is critical UX for non-engineer
    // readers — if generation drops it, App Store reviewers get a wall
    // of links with no orientation.
    expect(html).toContain('How to read these reports');
  });

  test('throws if the registry has no suites array', () => {
    expect(() => renderLanding({})).toThrow(/suites/);
  });

  test('throws if a suite is missing a required field', () => {
    expect(() =>
      renderLanding({
        suites: [{ slug: 'incomplete', displayName: 'X' /* icon, description missing */ }],
      }),
    ).toThrow();
  });
});
