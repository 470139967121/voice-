/**
 * Pins ios-tests.yml's build-ios job against cold-cache OOT cancellations.
 *
 * Triggered by: PR #714 was the first PR after PR #708 (which enabled
 * iOS E2E gating) to touch iOS files. Its pr-checks run cancelled the
 * `build-ios` job at exactly 30 min — the job-level timeout. The cold
 * K/N compile alone takes 24-29 min on macos-latest; with CocoaPods
 * install + xcodebuild build-for-testing on top, 30 min is too tight.
 *
 * Mirrors the fix that PR #690 applied to deploy-dev.yml's
 * `distribute-ios` job: add a `~/.konan` cache step and bump the
 * job-level timeout so a fresh-VM cold run fits within budget.
 *
 * Coverage:
 *   - timeout-minutes is at least 60 (was 30 — too tight for cold case)
 *   - `~/.konan` cache step exists with the same key shape as deploy-dev
 *   - cache step appears BEFORE the gradle warm-up step (otherwise the
 *     warm-up sees no cache and the konan compiler downloads fresh)
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const IOS_TESTS_PATH = path.join(REPO_ROOT, '.github/workflows/ios-tests.yml');

/**
 * Reuse of the extractStep helper pattern from
 * `afk-install-artifacts.test.js` — locked semantics: throws on
 * unknown name, throws on duplicate name (ambiguity-strict), hardcoded
 * 6-space step indent.
 */
function extractStep(yamlText, stepName) {
  const lines = yamlText.split('\n');
  const stepHeader = `      - name: ${stepName}`;
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === stepHeader) matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(
      `Could not find step "${stepName}" in workflow file. ` +
        'Step was renamed, removed, or indentation changed.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous step name "${stepName}": found at lines ${matches.map((i) => i + 1).join(', ')}.`,
    );
  }
  const startIdx = matches[0];
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    if (lines[endIdx].startsWith('      - name:')) break;
    if (lines[endIdx].length > 0 && !lines[endIdx].startsWith(' ')) break;
    endIdx++;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

describe('ios-tests.yml — build-ios job cold-cache survival', () => {
  let yamlText;

  beforeAll(() => {
    yamlText = fs.readFileSync(IOS_TESTS_PATH, 'utf8');
  });

  // The original timeout was 30 min. Cold-case K/N alone takes 24-29
  // min on macos-latest; with pod install + xcodebuild build-for-testing
  // on top, 30 is below the floor. 60 gives ~15 min headroom over the
  // observed worst case (PR #714 hit 30:00 exactly).
  test('build-ios job timeout-minutes is at least 60', () => {
    // Match the timeout in the build-ios job block. Use a narrow
    // regex anchored at 4-space indent (job-level keys) within the
    // file. There's only one build-ios job so a global search is OK.
    const match = yamlText.match(/^ {2}build-ios:[\s\S]*?\n {4}timeout-minutes: (\d+)$/m);
    expect(match).not.toBeNull();
    const minutes = parseInt(match[1], 10);
    expect(minutes).toBeGreaterThanOrEqual(60);
  });

  // The `~/.konan` cache step is the missing piece — without it,
  // every iOS E2E build on a fresh runner downloads the full Kotlin
  // Native toolchain (~hundreds of MB). PR #690 added it to
  // deploy-dev.yml; ios-tests.yml never got the symmetric fix.
  test('caches ~/.konan via actions/cache step', () => {
    const cacheStep = extractStep(yamlText, 'Cache Kotlin/Native (~/.konan)');
    expect(cacheStep).toContain('actions/cache');
    expect(cacheStep).toContain('~/.konan');
  });

  // Cache key shape mirrors deploy-dev.yml: hash of
  // gradle/libs.versions.toml (the K/N version is part of the
  // toolchain version). Restore-keys fall back to the OS-scoped
  // prefix so a different version still gets partial warmth.
  test('konan cache key uses gradle/libs.versions.toml hash', () => {
    const cacheStep = extractStep(yamlText, 'Cache Kotlin/Native (~/.konan)');
    expect(cacheStep).toContain("hashFiles('gradle/libs.versions.toml')");
  });

  test('konan cache step has restore-keys for partial warmth', () => {
    const cacheStep = extractStep(yamlText, 'Cache Kotlin/Native (~/.konan)');
    expect(cacheStep).toContain('restore-keys:');
  });

  // Order matters: cache restore must happen BEFORE the gradle
  // warm-up step, otherwise the warm-up sees an empty ~/.konan and
  // downloads the toolchain fresh — making the cache pointless on
  // its own first run AND on every subsequent run that misses.
  test('konan cache step appears before the Build shared KMP framework step', () => {
    const cacheStepIdx = yamlText.indexOf('- name: Cache Kotlin/Native (~/.konan)');
    const kmpBuildIdx = yamlText.indexOf('- name: Build shared KMP framework for iOS Simulator');
    expect(cacheStepIdx).toBeGreaterThanOrEqual(0);
    expect(kmpBuildIdx).toBeGreaterThanOrEqual(0);
    expect(cacheStepIdx).toBeLessThan(kmpBuildIdx);
  });
});
