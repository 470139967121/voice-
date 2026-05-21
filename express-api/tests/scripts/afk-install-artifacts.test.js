/**
 * Asserts the CI artifact surface needed for autonomous install of
 * dev + local flavors on both physical devices (OnePlus + iPhone).
 *
 * Coverage after PR #713:
 *   - Android dev:    pr-checks.yml uploads `dev-release-apk` (pre-existing)
 *   - Android local:  pr-checks.yml uploads `local-debug-apk`   (this PR)
 *   - iOS dev:        deploy-dev.yml uploads `dev-ios-ipa`       (this PR)
 *   - iOS local:      out of scope — no Xcode scheme exists (Phase 3)
 *
 * Each upload pins:
 *   - name (artifact identifier for `gh run download`)
 *   - path (gradle output dir / runner.temp export dir)
 *   - if-no-files-found: error  (fail loud on empty glob — without
 *     this, the default `warn` produces a successful empty-zip
 *     upload that breaks AFK install silently)
 *   - retention-days: 7 (matched between APK and IPA for consistency)
 *
 * Implementation: block-extraction helper similar to the Phase 1
 * pattern in `local-stack-resource-diet.test.js` /
 * `pr-checks-ios-gating.test.js`. Anchors each assertion to a
 * specific upload-artifact step block so a comment elsewhere in
 * the YAML mentioning the artifact name can't drift the match.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PR_CHECKS_PATH = path.join(REPO_ROOT, '.github/workflows/pr-checks.yml');
const DEPLOY_DEV_PATH = path.join(REPO_ROOT, '.github/workflows/deploy-dev.yml');

/**
 * Extract an `actions/upload-artifact` step block by its artifact
 * `name:` value. Returns the YAML text from the `- name: Upload …`
 * step header through the end of that step's `with:` block (i.e.
 * up to the next `      - name:` step header or the next top-level
 * key). Anchors assertions to a single step so they can't drift to
 * another step's `with:` block.
 */
function extractUploadStep(yamlText, artifactName) {
  const lines = yamlText.split('\n');
  const nameLine = `          name: ${artifactName}`;
  const startIdx = lines.findIndex((l) => l === nameLine);
  if (startIdx < 0) {
    throw new Error(
      `Could not find upload-artifact step for name "${artifactName}". ` +
        'Step was renamed, removed, or indentation changed.',
    );
  }
  // From the name line, walk back to the step header `- name: …`
  let headerIdx = startIdx;
  while (headerIdx > 0 && !lines[headerIdx].match(/^ {6}- name:/)) headerIdx--;
  // From the name line, walk forward until the next `      - name:`
  // step header or `^[a-zA-Z]` top-level key.
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    if (lines[endIdx].match(/^ {6}- name:/)) break;
    if (lines[endIdx].match(/^[a-zA-Z_]/)) break;
    endIdx++;
  }
  return lines.slice(headerIdx, endIdx).join('\n');
}

describe('CI artifact surface for AFK install', () => {
  describe('pr-checks.yml — Android local-flavor APK', () => {
    let yamlText;
    let uploadBlock;

    beforeAll(() => {
      yamlText = fs.readFileSync(PR_CHECKS_PATH, 'utf8');
      uploadBlock = extractUploadStep(yamlText, 'local-debug-apk');
    });

    test('runs assembleLocalDebug somewhere in the workflow', () => {
      expect(yamlText).toMatch(/\bassembleLocalDebug\b/);
    });

    test('upload step uses the local-debug-apk artifact name', () => {
      expect(uploadBlock).toContain('name: local-debug-apk');
    });

    test('path points at the gradle local-debug output dir', () => {
      expect(uploadBlock).toContain('path: app/build/outputs/apk/local/debug/*.apk');
    });

    test('if-no-files-found: error (fail loud on empty glob)', () => {
      // Default `warn` would silently produce an empty zip — gh run
      // download would succeed with an empty dir, breaking AFK
      // install. `error` is the only acceptable value here.
      expect(uploadBlock).toContain('if-no-files-found: error');
    });

    test('retention-days is set (avoids 90-day default accumulation)', () => {
      expect(uploadBlock).toMatch(/^ {10}retention-days: 7$/m);
    });
  });

  describe('deploy-dev.yml — iOS dev IPA artifact', () => {
    let yamlText;
    let uploadBlock;

    beforeAll(() => {
      yamlText = fs.readFileSync(DEPLOY_DEV_PATH, 'utf8');
      uploadBlock = extractUploadStep(yamlText, 'dev-ios-ipa');
    });

    test('upload step uses the dev-ios-ipa artifact name', () => {
      expect(uploadBlock).toContain('name: dev-ios-ipa');
    });

    test('path points at the runner.temp export directory', () => {
      // Actions-expression `${{ runner.temp }}` is required here —
      // shell-env `$RUNNER_TEMP` is NOT expanded in the `path:`
      // field of an upload-artifact step.
      expect(uploadBlock).toContain('path: ${{ runner.temp }}/export/*.ipa');
    });

    test('if-no-files-found: error (defence-in-depth for naming changes)', () => {
      expect(uploadBlock).toContain('if-no-files-found: error');
    });

    test('retention-days is 7 (matches APK retention for consistency)', () => {
      expect(uploadBlock).toMatch(/^ {10}retention-days: 7$/m);
    });

    test('upload step runs BEFORE the TestFlight upload step', () => {
      // The IPA artifact must be uploaded before the TestFlight
      // upload step. If the order were reversed, a TestFlight
      // failure could short-circuit the workflow before the
      // operator-facing artifact was produced.
      const uploadStepIdx = yamlText.indexOf('name: dev-ios-ipa');
      const testflightStepIdx = yamlText.indexOf('Upload to TestFlight');
      expect(uploadStepIdx).toBeGreaterThanOrEqual(0);
      expect(testflightStepIdx).toBeGreaterThanOrEqual(0);
      expect(uploadStepIdx).toBeLessThan(testflightStepIdx);
    });
  });

  describe('extractUploadStep helper — error branch', () => {
    let yamlText;

    beforeAll(() => {
      yamlText = fs.readFileSync(PR_CHECKS_PATH, 'utf8');
    });

    test('throws a clear error for unknown artifact names', () => {
      expect(() => extractUploadStep(yamlText, 'nonexistent-artifact')).toThrow(
        /Could not find upload-artifact step for name "nonexistent-artifact"/,
      );
    });
  });
});
