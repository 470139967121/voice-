/**
 * Web driver backed by the `playwright` package.
 *
 * Exposes the ctx.webDriver methods that manual-qa-runner.js matchers
 * call. Each method does the real Chromium work — navigate, click,
 * read text, snapshot accessibility tree, dispatch Firebase auth
 * via the page's runtime — so that scenarios from .feature files
 * exercise the real ShyTalk web surface (not jest spy stubs).
 *
 * Wiring: runner main() instantiates `await createWebDriver({ baseURL })`
 * and attaches the returned object to ctx.webDriver. Close at end of run.
 *
 * Method-naming contract (must match what matchers call):
 *   - Each method is `async (...args) => boolean | true-ish`
 *   - Method names mirror the matcher's `methodName` dispatch
 *     (e.g., `webShowsRoomClosedSummary`, `webShowsCountBadge`)
 *   - First arg is typically the actor's persona name (string)
 *
 * Initial implementation: STUB FOR EVERY METHOD that returns false +
 * logs "not implemented yet" so the runner produces a finding instead
 * of crashing on undefined. As scenarios are exercised, methods get
 * real implementations one at a time.
 */
const path = require('path');

let _playwright;
function loadPlaywright() {
  if (_playwright) return _playwright;
  // Resolve `playwright` from the repo root node_modules (not express-api/).
  const repoRoot = path.resolve(__dirname, '../../..');
  const playwrightPath = path.join(repoRoot, 'node_modules', 'playwright');
  // eslint-disable-next-line global-require, sonarjs/no-require-or-define
  _playwright = require(playwrightPath);
  return _playwright;
}

/**
 * Method-name list the runner expects (extracted by scanning matchers
 * for `ctx.webDriver?.<methodName>` references). Each is stubbed below.
 * The list is the source of truth for "what scenarios will be able to
 * exercise"; additions/removals here must mirror runner matcher edits.
 */
const WEB_METHOD_NAMES = [
  // Wake 86-106 vocabulary — extracted by grep over runner. Currently
  // all return false (not implemented). As scenarios surface needs,
  // each method gets a real Playwright body.
  'webAdminShowsAppealText',
  'webAdminShowsDashboardCounters',
  'webAdminShowsNewReportInQueue',
  'webAdminShowsRowCountInTable',
  'webAdminShowsRowForWithStatus',
  'webAdminShowsStat',
  'webAdminShowsTableOf',
  'webAlsoShowsInParticipantsList',
  'webApproveSeatRequest',
  'webDashboardReportsCounterEquals',
  'webDisablesInput',
  'webIsNoLongerInVoiceRoom',
  'webIsStillInRoom',
  'webJoinEventRoom',
  'webNavigatesBackToTab',
  'webNavigatesToPath',
  'webNavigatesToProfileScreen',
  'webNavigatesToRoomScreen',
  'webNavigatesToWarningScreen',
  'webOpenProfileAndTap',
  'webOpenProfileFrom',
  'webOpensTab',
  'webPairedSessionShowsSameTotals',
  'webPmDoesNotRenderInEnglish',
  'webPmBodyShowsRawKeyOrPlaceholder',
  'webRailShowsLessonsForLanguage',
  'webRefreshLanguageRail',
  'webReplacesFollowButton',
  'webShowsBalanceViaListener',
  'webShowsBanner',
  'webShowsBeansPerWeekChart',
  'webShowsCardBadge',
  'webShowsContributorsList',
  'webShowsCountBadge',
  'webShowsEditedBodyWithTag',
  'webShowsFrozenBanner',
  'webShowsGiftFromSender',
  'webShowsInAppGiftNotification',
  'webShowsInResults',
  'webShowsInSeatGrid',
  'webShowsInThread',
  'webShowsMessageInConversationThread',
  'webShowsMicIconAs',
  'webShowsNamedKind',
  'webShowsNewGiftEntry',
  'webShowsNewUnreadConversation',
  'webShowsNonEmptyLocaleText',
  'webShowsOfficialBadge',
  'webShowsOnlyMinorCohortInRankings',
  'webShowsOwnRankInTop',
  'webShowsPmThreadDirection',
  'webShowsRoomClosedSummary',
  'webShowsRoomWarningBanner',
  'webShowsSecondOffensiveMessage',
  'webShowsSeatRequestNotification',
  'webShowsSeatWithIndicator',
  'webShowsStalkersDelta',
  'webShowsSystemPmFromOfficia',
  'webShowsToastAndNavigates',
  'webShowsToastAndNavigatesBack',
  'webShowsUserCard',
  'webShowsUserCardSkeletons',
  'webShowsWarningScreenOnRelaunch',
  'webShowsWarningScreenWithReason',
  'webShowsWelcomePmInLanguage',
  'webSubmitStarFeedback',
  'webTapFromSurface',
  'webPairedSessionShowsSameTotals',
  // Append-only — add new method names as new matchers land.
];

/**
 * Returns an array of unique method names. Some names repeat above for
 * ergonomic reading; Set normalises.
 */
function listMethods() {
  return [...new Set(WEB_METHOD_NAMES)].sort();
}

/**
 * Create a web driver instance.
 *
 *   const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });
 *   ctx.webDriver = driver;
 *   // ... run scenarios ...
 *   await driver.close();
 *
 * The driver owns one Chromium browser context; per-persona pages are
 * created lazily inside `pageFor(name)` so multi-actor scenarios
 * (j16 event host with paired session) get isolated cookies/storage.
 */
async function createWebDriver({ baseURL = 'http://localhost:8888', headless = true } = {}) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless });
  const pages = new Map(); // persona name → Page

  async function pageFor(name) {
    if (pages.has(name)) return pages.get(name);
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    pages.set(name, page);
    return page;
  }

  const driver = { _browser: browser, _pages: pages, pageFor };

  // Wire every known method as a stub returning false + logging.
  for (const methodName of listMethods()) {
    driver[methodName] = async (...args) => {
      // Driver-stub silent-fail signal — runner will surface this as a
      // Major finding rather than crashing.
      console.error(
        `[web-driver] stub:${methodName}(${args.map((a) => JSON.stringify(a)).join(', ')}) — not implemented yet`,
      );
      return false;
    };
  }

  driver.close = async () => {
    for (const p of pages.values()) {
      await p.context().close();
    }
    await browser.close();
  };

  return driver;
}

module.exports = { createWebDriver, listMethods, WEB_METHOD_NAMES };
