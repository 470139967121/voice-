/**
 * ios-tests.yml — xcodebuild log capture + artifact upload
 *
 * Phase 3.3 attempt #1 (PR #719) failed in `Build iOS app for
 * testing` at 40m34s, but GitHub Actions truncated the 48k-line
 * log somewhere in the gRPC compile flood, hiding the actual error
 * in a 12-min gap. With the build log uploaded as a workflow
 * artifact, ANY future iOS build failure is debuggable via
 * `gh run download <run-id> -n ios-xcodebuild-logs`.
 *
 * This file pins the wiring:
 *   - `Build iOS app for testing` pipes through `tee` to a file
 *     under build/ios-build-logs/
 *   - `set -o pipefail` is set so xcodebuild's non-zero exit is
 *     preserved through the tee pipe (without it, tee always exits
 *     0 and masks the build failure)
 *   - A subsequent `Upload xcodebuild logs` step uploads
 *     build/ios-build-logs/ as the `ios-xcodebuild-logs` artifact
 *   - That step has `if: always()` so it runs on failure (the
 *     critical case — failures are when we need the log)
 *   - `if-no-files-found: error` so an empty zip is treated as a
 *     bug (defence against tee never receiving output)
 *
 * Without this contract: a future workflow refactor that drops
 * `set -o pipefail`, removes the tee, or strips `if: always()`
 * silently re-blinds CI debugging.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const IOS_TESTS_YML = path.join(REPO_ROOT, '.github/workflows/ios-tests.yml');
const UPLOAD_ARTIFACT_SHA = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

/**
 * Extract a step block from a YAML by its `- name:` header. Returns
 * the slice from the header up to the next 6-space step or job
 * boundary. Uses the same line-anchored approach as sibling test
 * files (extractStep in afk-install-artifacts.test.js).
 */
function extractStepBody(yamlText, stepName) {
  const stepHeader = `      - name: ${stepName}`;
  const startIdx = yamlText.indexOf(stepHeader);
  if (startIdx < 0) {
    throw new Error(`Step "${stepName}" not found in YAML.`);
  }
  const rest = yamlText.slice(startIdx + stepHeader.length);
  const nextStepIdx = rest.indexOf('\n      - ');
  const nextJobKeyIdx = rest.indexOf('\n    outputs:');
  const candidates = [nextStepIdx, nextJobKeyIdx].filter((i) => i >= 0);
  const stopAt = candidates.length > 0 ? Math.min(...candidates) : rest.length;
  return rest.slice(0, stopAt);
}

describe('ios-tests.yml — xcodebuild log capture + artifact upload', () => {
  let yamlText;

  beforeAll(() => {
    yamlText = fs.readFileSync(IOS_TESTS_YML, 'utf8');
  });

  describe('Build iOS app for testing — log capture', () => {
    test('Build step pipes xcodebuild output through tee to build/ios-build-logs/', () => {
      const body = extractStepBody(yamlText, 'Build iOS app for testing');
      expect(body).toContain('build/ios-build-logs/');
      // The tee target file name pinned so the upload step can
      // glob it. `xcodebuild-build-for-testing.log` matches the
      // step's semantic purpose.
      expect(body).toMatch(/tee\s+build\/ios-build-logs\/xcodebuild-build-for-testing\.log/);
    });

    test('Build step sets `set -o pipefail` BEFORE the xcodebuild pipe', () => {
      // Without pipefail, tee's exit 0 swallows xcodebuild's non-
      // zero exit and the step appears to "succeed" even when the
      // build failed. pipefail propagates the leftmost non-zero
      // exit through the pipe. Use `xcodebuild build-for-testing`
      // (the specific command) so indexOf doesn't land on the word
      // "xcodebuild" inside the comment block above the run script.
      const body = extractStepBody(yamlText, 'Build iOS app for testing');
      const pipefailIdx = body.indexOf('set -o pipefail');
      const xcodebuildCmdIdx = body.indexOf('xcodebuild build-for-testing');
      expect(pipefailIdx).toBeGreaterThanOrEqual(0);
      expect(xcodebuildCmdIdx).toBeGreaterThan(pipefailIdx);
    });

    test('Build step creates the log directory before tee tries to write to it', () => {
      // tee fails if the parent directory doesn't exist. `mkdir -p`
      // is idempotent and must precede the xcodebuild | tee pipe.
      // Use the specific command `xcodebuild build-for-testing` so
      // the indexOf doesn't land on the word "xcodebuild" inside
      // the step's comment block.
      const body = extractStepBody(yamlText, 'Build iOS app for testing');
      const mkdirIdx = body.indexOf('mkdir -p build/ios-build-logs');
      const xcodebuildCmdIdx = body.indexOf('xcodebuild build-for-testing');
      expect(mkdirIdx).toBeGreaterThanOrEqual(0);
      expect(xcodebuildCmdIdx).toBeGreaterThan(mkdirIdx);
    });
  });

  describe('Upload xcodebuild logs — artifact step', () => {
    test('Upload xcodebuild logs step exists', () => {
      expect(yamlText).toContain('      - name: Upload xcodebuild logs');
    });

    test('Upload step uses pinned actions/upload-artifact SHA', () => {
      const body = extractStepBody(yamlText, 'Upload xcodebuild logs');
      expect(body).toContain(UPLOAD_ARTIFACT_SHA);
    });

    test('Upload step has if: always() so it runs ON FAILURE (the critical case)', () => {
      // The whole point of this artifact is debugging failures. If
      // `if: always()` is missing, the upload only runs when the
      // build succeeds — exactly the opposite of when we need it.
      // Plain substring check avoids sonarjs/slow-regex (\s+ would
      // be unbounded). The step uses exactly 8 leading spaces.
      const body = extractStepBody(yamlText, 'Upload xcodebuild logs');
      expect(body).toContain('\n        if: always()');
    });

    test('Upload step uses artifact name ios-xcodebuild-logs', () => {
      const body = extractStepBody(yamlText, 'Upload xcodebuild logs');
      expect(body).toContain('name: ios-xcodebuild-logs');
    });

    test('Upload step uses if-no-files-found: error (defence against silent empty zips)', () => {
      // Default `warn` would silently produce an empty zip if the
      // tee never wrote anything (e.g. xcodebuild failed before
      // emitting output). `error` makes the missing-log condition
      // a loud failure.
      const body = extractStepBody(yamlText, 'Upload xcodebuild logs');
      expect(body).toContain('if-no-files-found: error');
    });

    test('Upload step path globs the build/ios-build-logs/ directory', () => {
      const body = extractStepBody(yamlText, 'Upload xcodebuild logs');
      // Plain substring match avoids sonarjs/slow-regex (\s* is
      // unbounded). YAML uses exactly one space after `path:`.
      expect(body).toContain('path: build/ios-build-logs');
    });

    test('Upload step runs AFTER Build iOS app for testing (so the log file exists)', () => {
      const buildIdx = yamlText.indexOf('      - name: Build iOS app for testing');
      const uploadIdx = yamlText.indexOf('      - name: Upload xcodebuild logs');
      expect(buildIdx).toBeGreaterThanOrEqual(0);
      expect(uploadIdx).toBeGreaterThan(buildIdx);
    });

    test('Upload step has retention-days: 7 (matches the existing iOS test-bundle artifact)', () => {
      const body = extractStepBody(yamlText, 'Upload xcodebuild logs');
      expect(body).toMatch(/retention-days:\s*7/);
    });
  });
});
