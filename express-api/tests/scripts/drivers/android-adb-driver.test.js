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
 *   - jest.useFakeTimers() so the driver's settle setTimeout(s) don't
 *     pay real wall-clock seconds (Round 1 review I-2 fix)
 *   - Build the driver via createAndroidDriver({ serial: 'emulator-5554' })
 *   - Call the new driver method (with jest.advanceTimersByTimeAsync
 *     if it awaits a settle delay)
 *   - Assert returned value + the exact `adb ... input tap X Y`
 *     coordinates were issued (centre of the dumped element)
 *
 * Tests run on Linux CI (no real device needed) — execSync is mocked
 * end-to-end, no spawn ever reaches the system shell.
 *
 * Mock fixture grounding: resource-ids in the mock XML use the SAME
 * Compose testTags that exist in
 *   shared/src/commonMain/kotlin/com/shyden/shytalk/feature/main/MainScreen.kt
 * (main_roomsTab / main_messagesTab / main_profileTab). A self-
 * referential mock (where the test fabricates an id that happens to
 * match whatever candidate the driver tries) proves nothing about
 * real-device behaviour. Round 1 review C-2 fix.
 */

jest.mock('child_process');

const { execSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const { createAndroidDriver } = require(
  path.join(REPO_ROOT, 'express-api/scripts/drivers/android-adb-driver'),
);

/**
 * Build a mock execSync responder driven by a cmd-substring → output
 * map. Each `pattern` is matched against the full shell-quoted
 * command string `adb()` produces ('adb' '-s' '<serial>' 'shell' '...').
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

/**
 * Helper: build a dump-XML response with one node carrying the
 * given resource-id + bounds. Defaults to the package-qualified
 * form Android Compose UIs produce.
 */
function dumpWithId(resourceId, bounds = '[0,1900][270,2100]') {
  return `<node resource-id="com.shyden.shytalk.local:id/${resourceId}" bounds="${bounds}" />`;
}

describe('android-adb-driver — androidNavigatesBackToTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Round 1 review I-2: fake timers so the driver's 500ms settle
    // doesn't pay real wall-clock time. With 4 success-path tests
    // each waiting 500ms, real timers would add 2 seconds per run —
    // compounds badly across the ~29 remaining Phase 4 PRs.
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Round 1 review C-1 + C-2: tests grounded to the REAL Compose
  // testTags in MainScreen.kt — main_roomsTab, main_messagesTab,
  // main_profileTab. These are the only three real tabs the matcher
  // would ever be called with via Wake 100.
  test('rooms tab — matches real main_roomsTab testTag', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_roomsTab', '[0,1900][270,2100]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidNavigatesBackToTab('Adam', 'rooms');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    // Centre of [0,1900][270,2100] = (135, 2000).
    expect(tapCall[0]).toContain("'135'");
    expect(tapCall[0]).toContain("'2000'");
  });

  test('messages tab — matches real main_messagesTab testTag', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_messagesTab', '[300,1900][600,2100]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidNavigatesBackToTab('Adam', 'messages');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'450'");
    expect(tapCall[0]).toContain("'2000'");
  });

  test('profile tab — matches real main_profileTab testTag', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_profileTab', '[600,1900][900,2100]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidNavigatesBackToTab('Adam', 'profile');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'750'");
    expect(tapCall[0]).toContain("'2000'");
  });

  test('case-insensitive — "Rooms" still resolves main_roomsTab', async () => {
    // The matcher's regex captures the literal tab name from the
    // feature file, which is conventionally lowercase but should
    // tolerate accidental capitalisation in scenarios.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_roomsTab'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidNavigatesBackToTab('Adam', 'Rooms');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
  });

  test('falls through to the bare-name candidate when main_<name>Tab has no match', async () => {
    // Future surfaces (non-main-nav, e.g. settings sub-tabs) may
    // use bare lowercased testTags. The driver tries main_<name>Tab
    // first; on no-match, tries bare name, etc.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('settings', '[100,500][400,700]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidNavigatesBackToTab('Adam', 'settings');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    // Centre of [100,500][400,700] = (250, 600).
    expect(tapCall[0]).toContain("'250'");
    expect(tapCall[0]).toContain("'600'");
    // Round 2 M-1: explicitly assert the fallthrough mechanic — 2
    // dump calls = 1 for the first-tried `main_settingsTab` (regex
    // miss) + 1 for the bare `settings` candidate (hit). Documents
    // intent so a future short-circuit refactor is caught.
    const dumpCalls = execSync.mock.calls.filter((c) => c[0].includes("'uiautomator' 'dump'"));
    expect(dumpCalls.length).toBe(2);
  });

  test('returns false when no candidate matches', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('unrelated_tag'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidNavigatesBackToTab('Adam', 'nonexistent');

    expect(ok).toBe(false);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeUndefined();
    // Round 2 M-2: the driver must try ALL 4 candidates before
    // giving up — main_nonexistentTab, nonexistent, tab_nonexistent,
    // bottomNav_nonexistent. Each candidate triggers one
    // androidUiDump (which is `uiautomator dump` + `cat`). 4 candidates
    // × 2 commands each = 8 calls per command type. Counting dump calls
    // catches a future short-circuit refactor that bails after 1 or 2
    // candidates.
    const dumpCalls = execSync.mock.calls.filter((c) => c[0].includes("'uiautomator' 'dump'"));
    expect(dumpCalls.length).toBe(4);
  });

  test('ignores the first arg (persona name) — same dump + different persona yields same result', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_roomsTab', '[0,1900][270,2100]'),
    });
    const driver = await createAndroidDriver();
    const pA = driver.androidNavigatesBackToTab('Adam', 'rooms');
    await jest.advanceTimersByTimeAsync(500);
    const okA = await pA;

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_roomsTab', '[0,1900][270,2100]'),
    });
    const driver2 = await createAndroidDriver();
    const pB = driver2.androidNavigatesBackToTab('Bea', 'rooms');
    await jest.advanceTimersByTimeAsync(500);
    const okB = await pB;

    expect(okA).toBe(true);
    expect(okB).toBe(true);
  });
});

describe('android-adb-driver — androidOpensTab', () => {
  // Wake 92 matcher (manual-qa-runner.js ~line 10755):
  //   `<Name> [P-NN] (cohort) opens the <X> tab on Android`
  // calls driver.androidOpensTab(name, tab). Mechanically identical
  // to Wake 100's androidNavigatesBackToTab — both tap the bottom-
  // nav tab with the given name. Kept as separate methods so
  // semantically-divergent behaviour (e.g. "open" might one day
  // launch a full screen, while "navigate back" stays a pure tab
  // tap) can land on the right method without API churn.
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('rooms tab — taps main_roomsTab via the shared main-nav helper', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_roomsTab', '[0,1900][270,2100]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidOpensTab('Marcus', 'rooms');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'135'");
    expect(tapCall[0]).toContain("'2000'");
  });

  test('home tab — case-insensitive lookup falls through to bare-name candidate', async () => {
    // The j17-teacher-classroom.feature scenario uses tab name "home",
    // which doesn't exist in MainScreen.kt (no main_homeTab). Driver
    // falls through to the bare-name candidate `home`. If the app ever
    // gains a Home tab with testTag `home` (not `main_homeTab`), this
    // test stays green.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('home', '[100,500][400,700]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidOpensTab('Marcus', 'home');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'250'");
    expect(tapCall[0]).toContain("'600'");
    // Same candidate iteration as androidNavigatesBackToTab — pinning
    // count enforces both methods stay on the shared helper.
    const dumpCalls = execSync.mock.calls.filter((c) => c[0].includes("'uiautomator' 'dump'"));
    expect(dumpCalls.length).toBe(2);
  });

  test('returns false when no candidate matches', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('unrelated_tag'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidOpensTab('Marcus', 'nonexistent');

    expect(ok).toBe(false);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeUndefined();
    // Round 1 I-1: same 4-candidate-exhaustion pin as the
    // androidNavigatesBackToTab no-match test. Catches a future
    // short-circuit refactor that bails after 1 or 2 candidates
    // on androidOpensTab specifically (the shared helper's
    // exhaustion is observable from both call sites).
    const dumpCalls = execSync.mock.calls.filter((c) => c[0].includes("'uiautomator' 'dump'"));
    expect(dumpCalls.length).toBe(4);
  });

  test('shared logic with androidNavigatesBackToTab — same dump, same tap centre', async () => {
    // Given identical dump XML and tab name, both methods produce
    // identical tap coordinates. Structural delegation (both call
    // the private `tapMainNavTab` helper) is verified by code
    // review — the helper is a private closure inaccessible to
    // external duplication. Round 1 I-2: prior comment overclaimed
    // this test "locks the share-an-implementation invariant" — it
    // doesn't (a copy-paste duplication would still pass). The
    // structural lock is the helper being private.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_messagesTab', '[300,1900][600,2100]'),
    });
    const driver = await createAndroidDriver();
    const pOpen = driver.androidOpensTab('Marcus', 'messages');
    await jest.advanceTimersByTimeAsync(500);
    const openOk = await pOpen;
    const openTap = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_messagesTab', '[300,1900][600,2100]'),
    });
    const driver2 = await createAndroidDriver();
    const pNav = driver2.androidNavigatesBackToTab('Marcus', 'messages');
    await jest.advanceTimersByTimeAsync(500);
    const navOk = await pNav;
    const navTap = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));

    expect(openOk).toBe(true);
    expect(navOk).toBe(true);
    // Same tap coordinates: centre of [300,1900][600,2100] = (450, 2000).
    expect(openTap[0]).toContain("'450'");
    expect(openTap[0]).toContain("'2000'");
    expect(navTap[0]).toContain("'450'");
    expect(navTap[0]).toContain("'2000'");
  });
});

describe('android-adb-driver — androidShowsBanner', () => {
  // Wake 97 matcher (manual-qa-runner.js ~line 11646):
  //   `<Name>'s Android UI shows a "<X>" banner`
  // The matcher passes (name, bannerText) — driver returns true
  // if the UI dump contains the banner text as either a text=
  // or content-desc= attribute value (substring match, with
  // negative-lookbehind guarding against attribute-name suffix
  // false-positives like hint-text=). Banners persist on-screen
  // until dismissed, so a dump scan is sufficient.
  //
  // Round 1 review M-3: no fake-timer setup here — the
  // implementation has no setTimeout. Keeps the describe block
  // simpler and signals that not every Phase 4 method needs the
  // tab-tap pattern's settle delay.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns true when banner text appears in a text= attribute', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node text="Connection lost — retrying" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'Connection lost');

    expect(ok).toBe(true);
  });

  test('returns true when banner text appears in a content-desc= attribute', async () => {
    // Icon-only banners often carry the message in content-desc
    // (for screen-reader accessibility) rather than text.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node content-desc="You are offline" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'offline');

    expect(ok).toBe(true);
  });

  test('substring match — banner phrase matches within a longer text', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node text="Warning: your room will close in 5 minutes" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'room will close');

    expect(ok).toBe(true);
  });

  test('returns false when banner text is absent', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="Welcome to ShyTalk" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'Connection lost');

    expect(ok).toBe(false);
  });

  test('returns false when the UI dump fails (empty)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'anything');

    expect(ok).toBe(false);
  });

  test('regex-special characters in banner text are escaped correctly', async () => {
    // A banner containing characters that would have regex meaning
    // (parentheses, brackets, dots, asterisks) must still match
    // literally. Without escaping, "Loading (1/3)..." would fail
    // because `(`, `)`, `.` are regex metachars.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node text="Loading (1/3)... please wait" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'Loading (1/3)...');

    expect(ok).toBe(true);
  });

  test('attribute-suffix false-positive guarded — hint-text= does NOT match', async () => {
    // Round 1 review I-2: without the (?<![\w-]) negative lookbehind,
    // the regex would match `t-text="Connection lost"` inside
    // `hint-text="Connection lost"` because the `text` alternation
    // would match the trailing `text` of `hint-text`. The lookbehind
    // rejects the match — only top-level `text=` or `content-desc=`
    // attribute names count. Other false-positive-prone attribute
    // names in Android XML: sub-text, placeholder-text, error-text.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node hint-text="Connection lost" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'Connection lost');

    expect(ok).toBe(false);
  });

  test('empty banner string returns false (not "match any node with text=")', async () => {
    // Round 1 review M-2: a scenario asking for `""` banner is an
    // authoring bug. The prior implementation matched ANY node with
    // a text= or content-desc= attribute, silently returning true and
    // masking the scenario error. Explicit early-return guards this.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="Welcome to ShyTalk" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', '');

    expect(ok).toBe(false);
  });

  test('persona name is ignored — same banner + different persona yields same result', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="Connection lost" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const okA = await driver.androidShowsBanner('Adam', 'Connection lost');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="Connection lost" bounds="[0,100][1080,200]" />',
    });
    const driver2 = await createAndroidDriver();
    const okB = await driver2.androidShowsBanner('Bea', 'Connection lost');

    expect(okA).toBe(true);
    expect(okB).toBe(true);
  });
});
