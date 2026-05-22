/**
 * android-adb-driver.js — driver-method unit tests
 *
 * Phase 4 of the journey-test framework build-out: per-method PRs
 * replace `false + log` stubs with real implementations. This file
 * is the test surface — each new method gets a describe block that
 * mocks `execSync` at module level and asserts the right `adb shell`
 * commands are issued + the right return value.
 *
 * Pattern (for future Phase 4 PRs to mirror):
 *   - jest.mock('child_process') with mockImplementation returning
 *     fixtures for `adb devices` + `cat /sdcard/dump.xml`
 *   - Build the driver via createAndroidDriver({ serial: 'emulator-5554' })
 *   - Call the new driver method
 *   - Assert returned value + the exact `adb ... input tap X Y`
 *     coordinates were issued (centre of the dumped element)
 *
 * Tests run on Linux CI (no real device needed) — execSync is mocked
 * end-to-end, no spawn ever reaches the system shell.
 */

jest.mock('child_process');

const { execSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const { createAndroidDriver } = require(
  path.join(REPO_ROOT, 'express-api/scripts/drivers/android-adb-driver'),
);

/**
 * Build a mock execSync responder driven by a simple cmd → output
 * map. The default responder returns '' (empty stdout) which is
 * the typical "command succeeded silently" adb behaviour.
 */
function mockExec(responses = {}) {
  execSync.mockImplementation((cmd) => {
    if (cmd === 'adb devices') {
      return responses['adb devices'] || 'List of devices attached\nemulator-5554\tdevice\n';
    }
    for (const [pattern, output] of Object.entries(responses)) {
      if (pattern === 'adb devices') continue;
      if (cmd.includes(pattern)) return output;
    }
    return '';
  });
}

describe('android-adb-driver — androidNavigatesBackToTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('taps the bottom-nav tab when the bare-tab-name tag matches', async () => {
    // Wake 100 matcher: `Adam's Android UI navigates back to the "feed" tab`.
    // Conventional Compose testTag in this codebase is the bare tab name
    // (e.g. `feed`, `discovery`, `inbox`, `me`). Bounds picked so the
    // expected centre is (135, 2000).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feed" bounds="[0,1900][270,2100]" />',
    });

    const driver = await createAndroidDriver();
    const ok = await driver.androidNavigatesBackToTab('Adam', 'feed');

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'135'");
    expect(tapCall[0]).toContain("'2000'");
  });

  test('falls through to the `tab_<name>` candidate when bare-name has no match', async () => {
    // First candidate (bare `discovery`) has no resource-id match; second
    // candidate `tab_discovery` matches. Driver should iterate, find the
    // second, tap it, return true.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/tab_discovery" bounds="[300,1900][600,2100]" />',
    });

    const driver = await createAndroidDriver();
    const ok = await driver.androidNavigatesBackToTab('Adam', 'discovery');

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'450'");
    expect(tapCall[0]).toContain("'2000'");
  });

  test('case-insensitive match — tab name in test passed as "Feed" still finds id/feed', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feed" bounds="[0,1900][270,2100]" />',
    });

    const driver = await createAndroidDriver();
    const ok = await driver.androidNavigatesBackToTab('Adam', 'Feed');

    expect(ok).toBe(true);
  });

  test('returns false when no candidate matches', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      // Dump has no matching resource-id for any of the candidate forms.
      "'cat' '/sdcard/dump.xml'": '<node resource-id="com.shyden.shytalk.local:id/unrelated" />',
    });

    const driver = await createAndroidDriver();
    const ok = await driver.androidNavigatesBackToTab('Adam', 'nonexistent');

    expect(ok).toBe(false);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeUndefined();
  });

  test('ignores the first arg (persona name) — the matcher passes it but it does not affect behaviour', async () => {
    // The matcher convention passes the persona name as the first
    // argument for logging/correlation. The actual tap logic only
    // depends on the `tab` arg. Same dump, different persona name.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inbox" bounds="[600,1900][900,2100]" />',
    });

    const driver = await createAndroidDriver();
    const okA = await driver.androidNavigatesBackToTab('Adam', 'inbox');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inbox" bounds="[600,1900][900,2100]" />',
    });

    const driver2 = await createAndroidDriver();
    const okB = await driver2.androidNavigatesBackToTab('Bea', 'inbox');

    expect(okA).toBe(true);
    expect(okB).toBe(true);
  });
});
