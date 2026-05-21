/**
 * Asserts the CI artifact surface needed for autonomous install of
 * dev + local flavors on both physical devices (OnePlus + iPhone).
 *
 * Today's gap (audit 2026-05-21):
 *   - Android dev:    pr-checks.yml uploads `dev-release-apk` ✓
 *   - Android local:  no local-flavor build target in CI → no artifact
 *   - iOS dev:        deploy-dev.yml exports an IPA to ${runner.temp}
 *                     but uploads only to TestFlight, no workflow
 *                     artifact → `gh run download` can't pull it
 *   - iOS local:      no Xcode scheme exists for local flavor —
 *                     covered by Phase 3, not this PR
 *
 * This PR adds the two missing artifact uploads so an AFK operator
 * (or automation) can install fresh Android local / iOS dev builds
 * without manual TestFlight invites or local builds.
 *
 * Implementation: regex assertions on the raw YAML, anchored to the
 * specific workflow + step structure to avoid cross-step drift.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PR_CHECKS_PATH = path.join(REPO_ROOT, '.github/workflows/pr-checks.yml');
const DEPLOY_DEV_PATH = path.join(REPO_ROOT, '.github/workflows/deploy-dev.yml');

describe('CI artifact surface for AFK install', () => {
  describe('pr-checks.yml — Android local-flavor APK', () => {
    let yamlText;

    beforeAll(() => {
      yamlText = fs.readFileSync(PR_CHECKS_PATH, 'utf8');
    });

    test('runs assembleLocalDebug somewhere in the workflow', () => {
      // Either as its own step or alongside the existing
      // assembleDevRelease. The KMP shared framework is compiled once
      // and reused for both flavors so the incremental cost is low.
      expect(yamlText).toMatch(/\bassembleLocalDebug\b/);
    });

    test('uploads the local-debug APK as a workflow artifact named local-debug-apk', () => {
      // Operator pulls via `gh run download <run-id> -n local-debug-apk`
      // mirroring the existing dev-release-apk download path.
      expect(yamlText).toMatch(/name:\s+local-debug-apk/);
    });

    test('the local-debug-apk path points at the gradle output dir', () => {
      // gradle's assembleLocalDebug emits to
      // `app/build/outputs/apk/local/debug/`. Slice + substring match
      // rather than multi-line regex to avoid sonarjs backtracking
      // flags — we narrow to the ~200 chars after the `name:` line
      // and assert the path substring appears within that window.
      const nameIdx = yamlText.indexOf('name: local-debug-apk');
      expect(nameIdx).toBeGreaterThanOrEqual(0);
      const sliceAfter = yamlText.slice(nameIdx, nameIdx + 200);
      expect(sliceAfter).toContain('path: app/build/outputs/apk/local/debug/*.apk');
    });
  });

  describe('deploy-dev.yml — iOS dev IPA artifact', () => {
    let yamlText;

    beforeAll(() => {
      yamlText = fs.readFileSync(DEPLOY_DEV_PATH, 'utf8');
    });

    test('uploads the exported IPA as a workflow artifact named dev-ios-ipa', () => {
      // The xcodebuild -exportArchive step writes the IPA to
      // ${runner.temp}/export/*.ipa for the subsequent TestFlight
      // upload. We add a workflow-artifact upload between (or after)
      // so AFK install can grab it without a TestFlight tester invite.
      expect(yamlText).toMatch(/name:\s+dev-ios-ipa/);
    });

    test('dev-ios-ipa path points at the runner.temp export directory', () => {
      // Actions-expression `${{ runner.temp }}` is required here —
      // shell-env `$RUNNER_TEMP` is NOT expanded in the `path:` field
      // of an `actions/upload-artifact` step. Slice + substring match
      // for the same reason as the local-debug-apk test above.
      const nameIdx = yamlText.indexOf('name: dev-ios-ipa');
      expect(nameIdx).toBeGreaterThanOrEqual(0);
      const sliceAfter = yamlText.slice(nameIdx, nameIdx + 200);
      expect(sliceAfter).toContain('path: ${{ runner.temp }}/export/*.ipa');
    });
  });
});
