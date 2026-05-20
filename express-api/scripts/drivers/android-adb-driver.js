/**
 * Android driver backed by `adb` (shell + uiautomator).
 *
 * Exposes the ctx.uiDriver methods that manual-qa-runner.js matchers
 * call for Android scenarios. The current implementation is a SCAFFOLD:
 * every method name from the matcher contract is wired to a stub that
 * returns false + logs a clear "not implemented" message. As scenarios
 * are exercised end-to-end, methods get real implementations one at a
 * time (input tap, uiautomator dump, am start, intent broadcast).
 *
 * Wiring contract:
 *   - `createAndroidDriver({ serial })` selects which adb device to drive.
 *   - Defaults to `adb-3b402284-56nfBT._adb-tls-connect._tcp` (the
 *     wireless physical device the operator has connected). Falls back
 *     to the first emulator if that serial isn't visible.
 *   - Methods accept the persona name as their first arg (matcher
 *     convention).
 *
 * Tooling notes:
 *   - `adb shell input tap X Y`              — taps a coordinate
 *   - `adb shell uiautomator dump --compressed /sdcard/dump.xml &&
 *      adb pull /sdcard/dump.xml -`          — gets the view tree
 *   - `adb shell am start -n pkg/.Activity`  — launches activity
 *   - `adb shell am broadcast -a ...`        — broadcasts intent
 *
 * The driver doesn't currently know which Activity each "screen"
 * corresponds to — that mapping needs to come from the app's
 * navigation registry. For now, methods log "not implemented" and the
 * runner surfaces a finding listing the matcher and the missing call.
 */
const { execSync } = require('child_process');

function selectSerial(preferredSerial) {
  let devices;
  try {
    devices = execSync('adb devices', { encoding: 'utf8' });
  } catch (_e) {
    return null;
  }
  const lines = devices.split('\n').filter((l) => /\tdevice$/.test(l));
  if (lines.length === 0) return null;
  const serials = lines.map((l) => l.split('\t')[0]);
  if (preferredSerial && serials.includes(preferredSerial)) return preferredSerial;
  // Prefer wireless TLS-connect device, then emulator.
  const wireless = serials.find((s) => s.includes('_adb-tls-connect'));
  if (wireless) return wireless;
  const emulator = serials.find((s) => s.startsWith('emulator-'));
  if (emulator) return emulator;
  return serials[0];
}

/**
 * Method-name list the runner expects on ctx.uiDriver for Android
 * scenarios. Extracted by grepping `androidXxx:` patterns in
 * manual-qa-runner.js. Each name maps to a stub returning false +
 * log; real implementations replace stubs incrementally.
 */
const ANDROID_METHOD_NAMES = [
  // Wake 86-106 vocabulary (matcher contract):
  'androidAdminShowsAppealText',
  'androidAdminShowsDashboardCounters',
  'androidAdminShowsNewReportInQueue',
  'androidAdminShowsRowCountInTable',
  'androidAdminShowsRowForWithStatus',
  'androidAdminShowsStat',
  'androidAdminShowsTableOf',
  'androidAlsoShowsInParticipantsList',
  'androidApproveSeatRequest',
  'androidContinuesNormallyInRoom',
  'androidDisablesInput',
  'androidIsNoLongerInVoiceRoom',
  'androidIsStillInRoom',
  'androidJoinEventRoom',
  'androidNavigatesBackToTab',
  'androidNavigatesToPath',
  'androidNavigatesToProfileScreen',
  'androidNavigatesToRoomScreen',
  'androidNavigatesToWarningScreen',
  'androidOpenProfileAndTap',
  'androidOpenProfileFrom',
  'androidOpensTab',
  'androidRefreshLanguageRail',
  'androidReplacesFollowButton',
  'androidShowsBalanceViaListener',
  'androidShowsBanner',
  'androidShowsBeansPerWeekChart',
  'androidShowsContributorsList',
  'androidShowsCountBadge',
  'androidShowsEditedBodyWithTag',
  'androidShowsFrozenBanner',
  'androidShowsGiftFromSender',
  'androidShowsInAppGiftNotification',
  'androidShowsInResults',
  'androidShowsInSeatGrid',
  'androidShowsInThread',
  'androidShowsMessageInConversationThread',
  'androidShowsMicIconAs',
  'androidShowsNamedKind',
  'androidShowsNewGiftEntry',
  'androidShowsNewUnreadConversation',
  'androidShowsNonEmptyLocaleText',
  'androidShowsOfficialBadge',
  'androidShowsOnlyMinorCohortInRankings',
  'androidShowsOwnRankInTop',
  'androidShowsPmThreadDirection',
  'androidShowsRoomClosedSummary',
  'androidShowsRoomWarningBanner',
  'androidShowsSecondOffensiveMessage',
  'androidShowsSeatRequestNotification',
  'androidShowsSeatWithIndicator',
  'androidShowsStalkersDelta',
  'androidShowsSystemPmFromOfficia',
  'androidShowsToastAndNavigates',
  'androidShowsToastAndNavigatesBack',
  'androidShowsUserCard',
  'androidShowsUserCardSkeletons',
  'androidShowsWarningScreenOnRelaunch',
  'androidShowsWarningScreenWithReason',
  'androidShowsWelcomePmInLanguage',
  'androidSubmitStarFeedback',
  'androidTapFromSurface',
  'androidDisablesInput',
  // From cycle-10 failure histogram:
  'androidOpenScreen',
  'androidTapByTag',
  'androidSearchIn',
  'androidScanAllRenderedStrings',
];

function listMethods() {
  return [...new Set(ANDROID_METHOD_NAMES)].sort();
}

/**
 * Create an Android driver instance.
 *
 *   const driver = await createAndroidDriver();
 *   ctx.uiDriver = driver;
 *
 * Real implementations land per-scenario. Currently all methods
 * return false + log "not implemented" so the runner produces a
 * concrete finding for each step rather than crashing.
 */
async function createAndroidDriver({ serial: preferred } = {}) {
  const serial = selectSerial(preferred);
  if (!serial) {
    throw new Error('No Android device connected (adb devices empty)');
  }
  const driver = { _serial: serial };

  function adb(args) {
    const cmd = ['adb', '-s', serial, ...args].map((a) => `'${a}'`).join(' ');
    return execSync(cmd, { encoding: 'utf8' });
  }
  driver.adb = adb;

  // Wire reverse port-forwards so wireless devices can reach
  // laptop-hosted local services (Express API, Firebase emulators,
  // LiveKit, MinIO). Without these, the app on a wireless device hits
  // a Technical-Difficulties screen because localhost on the DEVICE
  // is the device itself, not the laptop. Mirrors CLAUDE.md guidance
  // for "Android on physical device".
  for (const port of [3000, 7880, 9000, 8080, 9099, 9002]) {
    try {
      adb(['reverse', `tcp:${port}`, `tcp:${port}`]);
    } catch (e) {
      console.error(`[android-driver] adb reverse tcp:${port} failed: ${e.message}`);
    }
  }

  for (const methodName of listMethods()) {
    driver[methodName] = async (...args) => {
      console.error(
        `[android-driver] stub:${methodName}(${args.map((a) => JSON.stringify(a)).join(', ')}) — not implemented yet (device=${serial})`,
      );
      return false;
    };
  }

  // ── Real primitive implementations (override stubs) ─────────────────

  // Dump the current screen's view hierarchy via uiautomator. Returns
  // the raw XML string. Used by tag-targeted tap + assertion matchers
  // that scan for resource-id + bounds.
  driver.androidUiDump = async () => {
    try {
      adb(['shell', 'uiautomator', 'dump', '--compressed', '/sdcard/dump.xml']);
      const xml = adb(['shell', 'cat', '/sdcard/dump.xml']);
      return xml;
    } catch (e) {
      console.error(`[android-driver] androidUiDump failed: ${e.message}`);
      return '';
    }
  };

  // Tap at coordinate. Matchers compute (x, y) from the view dump's
  // bounds and call this primitive.
  driver.androidTap = async (x, y) => {
    try {
      adb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
      return true;
    } catch (e) {
      console.error(`[android-driver] androidTap(${x},${y}) failed: ${e.message}`);
      return false;
    }
  };

  // Dump the UI tree, find the bounds of the element with the given
  // resource-id (accepts short OR fully-qualified shapes), tap centre.
  // Returns true if found+tapped, false otherwise. Single-call replacement
  // for the dump+regex+tap dance many matchers do; future matchers should
  // call this instead of duplicating the logic.
  driver.androidTapByTag = async (tag) => {
    try {
      const dump = await driver.androidUiDump();
      const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // eslint-disable-next-line sonarjs/slow-regex
      const re = new RegExp(
        `resource-id="(?:[^"]*:id/)?${escTag}"[^<]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
      );
      const match = re.exec(dump);
      if (!match) return false;
      const [, x1, y1, x2, y2] = match.map((v, i) => (i === 0 ? v : Number(v)));
      const cx = Math.round((x1 + x2) / 2);
      const cy = Math.round((y1 + y2) / 2);
      return await driver.androidTap(cx, cy);
    } catch (e) {
      console.error(`[android-driver] androidTapByTag(${tag}) failed: ${e.message}`);
      return false;
    }
  };

  // Open named screen — launches the local-build app via MainActivity.
  // The app's AndroidManifest does NOT declare a `shytalk://` scheme
  // (only HTTPS auth deep-links per app/src/main/AndroidManifest.xml).
  // Without an in-app nav-via-intent mechanism, the best we can do is
  // launch the main activity and trust the app's startup routing to
  // land somewhere sensible (typically home or sign-in). Per-screen
  // navigation needs to be UI-driven (tap by uiautomator-dump tag) and
  // is the responsibility of higher-level matchers.
  driver.androidOpenScreen = async (name, screen) => {
    try {
      adb([
        'shell',
        'am',
        'start',
        '-n',
        'com.shyden.shytalk.local/com.shyden.shytalk.MainActivity',
      ]);
      // Brief settle so the activity has time to draw before subsequent
      // dump/tap calls. The 1.5s value mirrors what the existing
      // android-e2e tests use (see app/src/androidTest fixtures).
      await new Promise((r) => setTimeout(r, 1500));
      // Stash the requested screen on the driver so a future matcher
      // can use it as a hint when implementing real in-app navigation.
      driver._requestedScreen = { name, screen };
      return true;
    } catch (e) {
      console.error(`[android-driver] androidOpenScreen(${name},${screen}) failed: ${e.message}`);
      return false;
    }
  };

  driver.close = async () => {
    /* adb sessions are stateless; nothing to release */
  };

  return driver;
}

module.exports = { createAndroidDriver, listMethods, selectSerial, ANDROID_METHOD_NAMES };
