/**
 * Pins the local-stack memory caps so the 8GB MacBook can run the
 * full local Firebase Emulator + Docker stack + Express + Playwright
 * during journey testing without crossing the OOM threshold.
 *
 * Without caps:
 *   - Docker containers default to "use whatever's available"; under
 *     load LiveKit + MinIO + Mailpit can balloon past 2 GB combined
 *   - Firebase Emulator JVM defaults to a ~4 GB heap on macOS
 *
 * Caps applied (rationale per service in the workflow comments):
 *   - livekit:  256m  — small Go server, no media transcoding in tests
 *   - minio:    512m  — S3-like; small fixture data only
 *   - mailpit:  128m  — tiny mail interceptor
 *   - emulator: 1g    — Java; firestore + auth + RTDB in one JVM
 *
 * Total local-stack ceiling: ~1.9 GB. Combined with the ~6 GB
 * baseline (Claude, MCPs, system services, browsers under test) this
 * leaves ~100 MB - 1 GB of headroom on an 8 GB Mac depending on what
 * else is open — sufficient if `feedback-prepush-sonar-no-verify-on-8gb`
 * style measures are also applied.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const COMPOSE_PATH = path.join(REPO_ROOT, 'local/docker-compose.yml');
const START_SH_PATH = path.join(REPO_ROOT, 'local/start.sh');

describe('Local-stack resource diet', () => {
  describe('docker-compose.yml — per-service mem_limit', () => {
    let yamlText;

    beforeAll(() => {
      yamlText = fs.readFileSync(COMPOSE_PATH, 'utf8');
    });

    test('livekit service has mem_limit 256m', () => {
      // livekit-server is a Go binary; ~50-100MB steady-state.
      // 256m caps it under load (peer connections, audio relay)
      // without strangling the normal path.
      expect(yamlText).toMatch(/^ {2}livekit:[\s\S]+?mem_limit:\s+256m/m);
    });

    test('minio service has mem_limit 512m', () => {
      // MinIO is more memory-hungry than livekit because it pages
      // recent blocks. 512m is generous for the small fixture data
      // we exercise in tests.
      expect(yamlText).toMatch(/^ {2}minio:[\s\S]+?mem_limit:\s+512m/m);
    });

    test('mailpit service has mem_limit 128m', () => {
      // Mailpit is a tiny in-memory SMTP sink — 128m is plenty.
      expect(yamlText).toMatch(/^ {2}mailpit:[\s\S]+?mem_limit:\s+128m/m);
    });
  });

  describe('start.sh — Firebase Emulator JVM heap cap', () => {
    let scriptText;

    beforeAll(() => {
      scriptText = fs.readFileSync(START_SH_PATH, 'utf8');
    });

    test('JAVA_TOOL_OPTIONS sets -Xmx1g for firebase emulators:start', () => {
      // The Firebase emulator suite runs Firestore + Auth + RTDB
      // + UI in one JVM. Default heap is ~4 GB on macOS — overkill
      // for our fixture sizes. Cap at 1g to free ~3 GB of headroom
      // for browser-under-test + iOS-simulator-replacement work.
      //
      // `JAVA_TOOL_OPTIONS` is honoured by every JVM start in the
      // shell scope, not just firebase's. That's intentional: any
      // gradle/firebase-rules-deploy work that piggybacks on the
      // running shell gets the same cap.
      expect(scriptText).toMatch(/JAVA_TOOL_OPTIONS=.*-Xmx1g/);
    });

    test('JAVA_TOOL_OPTIONS export precedes the emulator launch', () => {
      // The env var must be in scope BEFORE `firebase emulators:start`
      // runs — otherwise the spawned JVM uses the default heap. Use
      // line-index comparison rather than a fragile regex.
      const exportIdx = scriptText.indexOf('JAVA_TOOL_OPTIONS');
      const launchIdx = scriptText.indexOf('firebase emulators:start');
      expect(exportIdx).toBeGreaterThanOrEqual(0);
      expect(launchIdx).toBeGreaterThanOrEqual(0);
      expect(exportIdx).toBeLessThan(launchIdx);
    });
  });
});
