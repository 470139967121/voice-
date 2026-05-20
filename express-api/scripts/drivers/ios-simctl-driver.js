/**
 * iOS driver backed by `xcrun simctl`.
 *
 * Exposes the ctx.uiDriver methods that manual-qa-runner.js matchers
 * call for iOS scenarios. Real implementations of UI taps + reads
 * require an instrumentation framework (XCUITest, Appium, or
 * idb-companion); the scaffold here provides `openurl`, `launch`,
 * `screenshot`, `status_bar` and stubs for the rest.
 *
 * Wiring contract:
 *   - `createIosDriver({ udid })` picks a booted simulator; defaults
 *     to the first booted device (`xcrun simctl list devices booted`).
 *   - Methods accept the persona name as their first arg (matcher
 *     convention).
 *
 * Tooling notes:
 *   - `xcrun simctl openurl <udid> <url>`         — deep-link
 *   - `xcrun simctl launch <udid> <bundleId>`     — launch app
 *   - `xcrun simctl io <udid> screenshot <path>`  — screenshot
 *   - `xcrun simctl status_bar <udid> override`   — set status bar
 *   - `xcrun simctl spawn <udid> log stream`      — log capture
 *
 * For tap interactions we'd need an XCTest runner attached — that's a
 * substantial integration beyond scaffold scope. Methods that need
 * UI interaction return false + log; methods that only need openurl
 * (e.g., navigate to a deep-link path) get real implementations now.
 */
const { execSync } = require('child_process');

function selectUdid(preferredUdid) {
  let raw;
  try {
    raw = execSync('xcrun simctl list devices booted', { encoding: 'utf8' });
  } catch (_e) {
    return null;
  }
  const m = raw.match(/\(([0-9A-F-]{36})\)\s*\(Booted\)/i);
  if (preferredUdid) return preferredUdid;
  return m ? m[1] : null;
}

const IOS_METHOD_NAMES = [
  'iosAdminShowsAppealText',
  'iosAdminShowsDashboardCounters',
  'iosAdminShowsNewReportInQueue',
  'iosAdminShowsRowCountInTable',
  'iosAdminShowsRowForWithStatus',
  'iosAdminShowsStat',
  'iosAdminShowsTableOf',
  'iosAlsoShowsInParticipantsList',
  'iosApproveSeatRequest',
  'iosContinuesNormallyInRoom',
  'iosDisablesInput',
  'iosIsNoLongerInVoiceRoom',
  'iosIsStillInRoom',
  'iosJoinEventRoom',
  'iosNavigatesBackToTab',
  'iosNavigatesToPath',
  'iosNavigatesToProfileScreen',
  'iosNavigatesToRoomScreen',
  'iosNavigatesToWarningScreen',
  'iosOpenProfileAndTap',
  'iosOpenProfileFrom',
  'iosOpensTab',
  'iosRefreshLanguageRail',
  'iosReplacesFollowButton',
  'iosShowsBalanceViaListener',
  'iosShowsBanner',
  'iosShowsBeansPerWeekChart',
  'iosShowsContributorsList',
  'iosShowsCountBadge',
  'iosShowsEditedBodyWithTag',
  'iosShowsFrozenBanner',
  'iosShowsGiftFromSender',
  'iosShowsInAppGiftNotification',
  'iosShowsInResults',
  'iosShowsInSeatGrid',
  'iosShowsInThread',
  'iosShowsMessageInConversationThread',
  'iosShowsMicIconAs',
  'iosShowsNamedKind',
  'iosShowsNewGiftEntry',
  'iosShowsNewUnreadConversation',
  'iosShowsNonEmptyLocaleText',
  'iosShowsOfficialBadge',
  'iosShowsOnlyMinorCohortInRankings',
  'iosShowsOwnRankInTop',
  'iosShowsPmThreadDirection',
  'iosShowsRoomClosedSummary',
  'iosShowsRoomWarningBanner',
  'iosShowsSecondOffensiveMessage',
  'iosShowsSeatRequestNotification',
  'iosShowsSeatWithIndicator',
  'iosShowsStalkersDelta',
  'iosShowsSystemPmFromOfficia',
  'iosShowsToastAndNavigates',
  'iosShowsToastAndNavigatesBack',
  'iosShowsUserCard',
  'iosShowsUserCardSkeletons',
  'iosShowsWarningScreenOnRelaunch',
  'iosShowsWarningScreenWithReason',
  'iosShowsWelcomePmInLanguage',
  'iosSubmitStarFeedback',
  'iosTapFromSurface',
  'iosOpenScreen',
  'iosTapByTag',
  'iosSearchIn',
  'iosScanAllRenderedStrings',
];

function listMethods() {
  return [...new Set(IOS_METHOD_NAMES)].sort();
}

async function createIosDriver({ udid: preferred } = {}) {
  const udid = selectUdid(preferred);
  if (!udid) {
    throw new Error('No booted iOS Simulator (xcrun simctl list devices booted is empty)');
  }
  const driver = { _udid: udid };

  function simctl(args) {
    const cmd = ['xcrun', 'simctl', ...args].map((a) => `'${a}'`).join(' ');
    return execSync(cmd, { encoding: 'utf8' });
  }
  driver.simctl = simctl;

  for (const methodName of listMethods()) {
    driver[methodName] = async (...args) => {
      console.error(
        `[ios-driver] stub:${methodName}(${args.map((a) => JSON.stringify(a)).join(', ')}) — not implemented yet (udid=${udid})`,
      );
      return false;
    };
  }

  // Real implementation: open named screen via deep-link.
  //
  // Calling convention: matchers pass the single screen identifier (e.g.,
  // "discovery", "wallet"). Earlier driver scaffolding used a two-arg
  // (persona, screen) signature that didn't match the matcher's actual
  // call, producing `shytalk://undefined` URLs and ~16 Blocker findings in
  // cycle 1. Single-arg form aligns with iosTap/androidOpenScreen.
  //
  // Caveat: the iOS app's Info.plist registers exactly one URL scheme
  // (the Google OAuth callback). There is no `shytalk://` scheme, so
  // simctl's openurl call will succeed at the shell level but the OS
  // surfaces a code=115 (LSApplicationWorkspaceErrorDomain) telling us
  // no app handles that scheme. We detect that and return a clear,
  // actionable error so the runner finding reads "deep-link unsupported,
  // use UI navigation" rather than a generic openurl failure.
  driver.iosOpenScreen = async (screen) => {
    try {
      const out = execSync(`xcrun simctl openurl '${udid}' 'shytalk://${screen}' 2>&1`, {
        encoding: 'utf8',
      });
      if (/error 115|failed to open/i.test(out)) {
        console.error(
          `[ios-driver] iosOpenScreen(${screen}): shytalk:// scheme is not registered in Info.plist; ` +
            'use iosTapByTag-driven navigation instead of openurl',
        );
        return false;
      }
      return true;
    } catch (e) {
      console.error(`[ios-driver] iosOpenScreen(${screen}) failed: ${e.message}`);
      return false;
    }
  };

  driver.close = async () => {
    /* simctl is stateless; nothing to release */
  };

  return driver;
}

module.exports = { createIosDriver, listMethods, selectUdid, IOS_METHOD_NAMES };
