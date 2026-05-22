/**
 * ios-tests.yml — build-ios job cold-cache survival
 *
 * Triggered by: PR #714 was the first PR after PR #708 (which enabled
 * iOS E2E gating) to touch iOS files. Its pr-checks `build-ios` job
 * cancelled at exactly 30 min — the job-level timeout. Cold K/N
 * compile alone takes 24-29 min on macos-15; with CocoaPods install +
 * xcodebuild build-for-testing on top, 30 min is too tight.
 *
 * Mirrors the fix PR #690 applied to deploy-dev.yml's distribute-ios
 * job: add a `~/.konan` cache step + bump the job-level timeout.
 *
 * Coverage:
 *   - timeout-minutes is at least 60 (was 30)
 *   - the new konan cache step exists, scoped to the build-ios job
 *   - SHA pin matches deploy-dev (supply-chain consistency)
 *   - cache key uses gradle/libs.versions.toml hash
 *   - restore-keys is OS-scoped (konan-${{ runner.os }}-) NOT bare
 *     (a bare `konan-` prefix would restore a Linux toolchain onto
 *     a macOS runner — silent corruption)
 *   - cache step appears before the gradle warm-up step
 *   - --max-workers=1 carries over from PR #690 (catches a future
 *     "CI speed optimisation" PR that removes the flag)
 *   - extractStep helper error branches (unknown name + non-6-space
 *     indent) — ambiguous-name omitted because no step names
 *     duplicate across jobs in ios-tests.yml today
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const IOS_TESTS_PATH = path.join(REPO_ROOT, '.github/workflows/ios-tests.yml');

/**
 * Extract a workflow step's full YAML block by its `- name:` header.
 * Mirror of the canonical helper in afk-install-artifacts.test.js
 * with the full error-message text (Round 1 review P-1 fix).
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
        'Step was renamed, removed, or indentation changed (helper ' +
        'requires 6-space step indent) — update this test to match.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous step name "${stepName}": found at lines ${matches
        .map((i) => i + 1)
        .join(', ')}. Use a more specific name or scope to a single job.`,
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

/**
 * Extract a job's full YAML block by its `<jobName>:` key at the
 * 2-space indent level (jobs.<jobName>). Stops at the next job header
 * or top-level YAML key. Lets us scope job-level key assertions
 * (timeout-minutes, runs-on) to the right job rather than relying on
 * lazy regex which can match a different job's keys (I-2).
 */
function extractJob(yamlText, jobName) {
  const lines = yamlText.split('\n');
  const jobHeader = `  ${jobName}:`;
  const startIdx = lines.findIndex((l) => l === jobHeader);
  if (startIdx < 0) {
    throw new Error(`Could not find job "${jobName}" in workflow file.`);
  }
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    if (/^ {2}[a-zA-Z_][\w-]*:$/.test(lines[endIdx])) break;
    if (lines[endIdx].length > 0 && !lines[endIdx].startsWith(' ')) break;
    endIdx++;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

describe('ios-tests.yml — build-ios job cold-cache survival', () => {
  let yamlText;
  let buildIosJob;
  let cacheStep;
  let kmpBuildStep;

  beforeAll(() => {
    yamlText = fs.readFileSync(IOS_TESTS_PATH, 'utf8');
    buildIosJob = extractJob(yamlText, 'build-ios');
    cacheStep = extractStep(yamlText, 'Cache Kotlin/Native (~/.konan)');
    kmpBuildStep = extractStep(yamlText, 'Build shared KMP framework for iOS Simulator');
  });

  // Original timeout was 30 min. Cold K/N alone = 24-29 min on
  // macos-15; with pod install + xcodebuild on top, 30 is below the
  // floor. 60 gives ~15 min headroom over the observed worst case
  // (PR #714 cancelled at 30:00 exactly).
  // I-2 fix: assert within the extracted build-ios job block so the
  // regex can't drift to another job's timeout-minutes.
  test('build-ios job timeout-minutes is at least 60', () => {
    const match = buildIosJob.match(/^ {4}timeout-minutes: (\d+)$/m);
    expect(match).not.toBeNull();
    const minutes = parseInt(match[1], 10);
    expect(minutes).toBeGreaterThanOrEqual(60);
  });

  test('Cache Kotlin/Native step uses actions/cache', () => {
    expect(cacheStep).toContain('actions/cache');
  });

  // M-1 fix: pin the exact SHA used by deploy-dev.yml so a
  // supply-chain shift (or a future SHA-pin "update") is caught.
  test('Cache Kotlin/Native step pins actions/cache@v5.0.5 SHA (matches deploy-dev)', () => {
    expect(cacheStep).toContain('actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae');
  });

  test('Cache Kotlin/Native step targets ~/.konan', () => {
    expect(cacheStep).toContain('~/.konan');
  });

  // Cache key shape mirrors deploy-dev.yml: hash of
  // gradle/libs.versions.toml (the Kotlin version is part of the
  // toolchain version).
  test('konan cache key uses gradle/libs.versions.toml hash', () => {
    expect(cacheStep).toContain("hashFiles('gradle/libs.versions.toml')");
  });

  // M-2 fix: assert the restore-keys VALUE, not just the presence
  // of the key word. A bare `konan-` prefix (missing the OS scope)
  // would restore a Linux toolchain onto a macOS runner — silent
  // corruption.
  test('konan cache restore-keys is OS-scoped (konan-${{ runner.os }}-)', () => {
    // Non-backtracking line-by-line scan: find the `restore-keys:`
    // line then verify the following line contains the OS-scoped
    // prefix. A bare `konan-` prefix (missing OS scope) would match
    // Linux toolchain entries and silently corrupt macOS runs.
    const lines = cacheStep.split('\n');
    const restoreKeysIdx = lines.findIndex((l) => l.includes('restore-keys:'));
    expect(restoreKeysIdx).toBeGreaterThanOrEqual(0);
    expect(lines[restoreKeysIdx + 1]).toContain('konan-${{ runner.os }}-');
  });

  // I-1 fix: anchor `indexOf` on the FULL 6-space prefix step header
  // (`      - name: …`), not the bare `- name: …` substring. A YAML
  // comment can never literally equal that prefix because comments
  // are introduced by `#`, not 6 spaces.
  test('konan cache step appears before the Build shared KMP framework step', () => {
    const cacheStepIdx = yamlText.indexOf('      - name: Cache Kotlin/Native (~/.konan)');
    const kmpBuildIdx = yamlText.indexOf(
      '      - name: Build shared KMP framework for iOS Simulator',
    );
    expect(cacheStepIdx).toBeGreaterThanOrEqual(0);
    expect(kmpBuildIdx).toBeGreaterThanOrEqual(0);
    expect(cacheStepIdx).toBeLessThan(kmpBuildIdx);
  });

  // M-4 fix: pin --max-workers=1 on the KMP build step. PR #690
  // documented that parallel K/N link tasks deadlock under macOS
  // runner memory pressure. A future "CI speed" PR removing the
  // flag would silently re-introduce the deadlock.
  test('KMP build step uses --max-workers=1 (prevents parallel K/N deadlock)', () => {
    expect(kmpBuildStep).toContain('--max-workers=1');
  });

  // P-3 fix: extractStep error-branch coverage matching the canonical
  // contract from afk-install-artifacts.test.js. Ambiguous-name case
  // omitted because no step names duplicate across jobs in
  // ios-tests.yml today — verified by inspection 2026-05-22.
  describe('extractStep helper — error branches', () => {
    test('throws a clear error for unknown step names', () => {
      expect(() => extractStep(yamlText, 'Nonexistent Step Name')).toThrow(
        /Could not find step "Nonexistent Step Name"/,
      );
    });

    test('throws when YAML uses non-6-space step indentation', () => {
      const fourSpaceIndent = '    - name: Some Step\n      run: echo hi\n';
      expect(() => extractStep(fourSpaceIndent, 'Some Step')).toThrow(
        /Could not find step "Some Step"/,
      );
    });
  });
});
