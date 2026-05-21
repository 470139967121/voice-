/**
 * Pins the local-stack memory caps so the 8GB MacBook can run the
 * full local Firebase Emulator + Docker stack during journey testing
 * without crossing the OOM threshold.
 *
 * Caps applied (rationale per service in the YAML comments):
 *   - livekit:        256m  (Go binary)
 *   - minio:          512m  (S3-like, small fixture data)
 *   - mailpit:        128m  (in-memory SMTP sink)
 *   - emulator JVM:   1g    (firestore + auth fixture sizes)
 *
 * Implementation: regex assertions on the raw YAML / shell text via
 * an extract-per-service-block helper that anchors each assertion to
 * a single block. Avoids the cross-boundary false-positive class
 * caught by code-review on the first cut of this file.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const COMPOSE_PATH = path.join(REPO_ROOT, 'local/docker-compose.yml');
const START_SH_PATH = path.join(REPO_ROOT, 'local/start.sh');

/**
 * Extract a single service's YAML block from docker-compose.yml so
 * subsequent assertions are scoped to ONE service and can't drift
 * across boundaries (e.g. asserting livekit's cap by accidentally
 * matching minio's). Anchored on the `^  <name>:$` line and stops
 * at the next `^  <word>:$` line.
 */
function extractServiceBlock(yamlText, serviceName) {
  const lines = yamlText.split('\n');
  const startPattern = new RegExp(`^  ${serviceName}:$`);
  const nextServicePattern = /^ {2}\w[\w-]*:$/;
  let inBlock = false;
  const block = [];
  for (const line of lines) {
    if (startPattern.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (nextServicePattern.test(line)) break;
      block.push(line);
    }
  }
  if (!inBlock) {
    throw new Error(
      `Could not find service "${serviceName}" in ${COMPOSE_PATH}. ` +
        'Service was renamed or removed — update this test to match.',
    );
  }
  return block.join('\n');
}

describe('Local-stack resource diet', () => {
  describe('docker-compose.yml — per-service memory caps', () => {
    let yamlText;
    let livekitBlock;
    let minioBlock;
    let mailpitBlock;

    beforeAll(() => {
      yamlText = fs.readFileSync(COMPOSE_PATH, 'utf8');
      livekitBlock = extractServiceBlock(yamlText, 'livekit');
      minioBlock = extractServiceBlock(yamlText, 'minio');
      mailpitBlock = extractServiceBlock(yamlText, 'mailpit');
    });

    // Service-body lines under a top-level `  service:` header are
    // indented with exactly 4 spaces in this file's YAML style. Using
    // ` {4}` (fixed-width) avoids sonarjs/slow-regex flagging on the
    // unbounded `\s+` quantifier, and is also more precise.

    // livekit — Go binary, ~50-100MB steady-state; 256m cap is generous
    // but prevents balloon under voice-room peer-connection spikes.
    test('livekit has mem_limit 256m', () => {
      expect(livekitBlock).toMatch(/^ {4}mem_limit: 256m$/m);
    });

    test('livekit has memswap_limit 256m (swap disabled)', () => {
      expect(livekitBlock).toMatch(/^ {4}memswap_limit: 256m$/m);
    });

    // minio — pages recent blocks; 512m is generous for fixture sizes.
    test('minio has mem_limit 512m', () => {
      expect(minioBlock).toMatch(/^ {4}mem_limit: 512m$/m);
    });

    test('minio has memswap_limit 512m (swap disabled)', () => {
      expect(minioBlock).toMatch(/^ {4}memswap_limit: 512m$/m);
    });

    // mailpit — tiny in-memory SMTP sink, 128m is plenty.
    test('mailpit has mem_limit 128m', () => {
      expect(mailpitBlock).toMatch(/^ {4}mem_limit: 128m$/m);
    });

    test('mailpit has memswap_limit 128m (swap disabled)', () => {
      expect(mailpitBlock).toMatch(/^ {4}memswap_limit: 128m$/m);
    });
  });

  describe('start.sh — Firebase Emulator JVM heap cap is scoped to the firebase process', () => {
    let scriptText;

    beforeAll(() => {
      scriptText = fs.readFileSync(START_SH_PATH, 'utf8');
    });

    // The cap is applied via `env VAR=val cmd` prefix so it scopes to
    // the firebase CLI process only — NOT exported at shell-scope where
    // it would leak into the later `./gradlew` invocation in Step 7
    // and starve Kotlin compilation (which needs 2-4 GB heap).
    test('uses env-prefix scoping, not a shell-scope export', () => {
      // The operative line must be of the form
      // `env JAVA_TOOL_OPTIONS="-Xmx1g" npx firebase emulators:start ...`
      // anchored at line-start to skip comments that reference the
      // identifier.
      expect(scriptText).toMatch(/^env JAVA_TOOL_OPTIONS="-Xmx1g" npx firebase emulators:start/m);
    });

    // Defence-in-depth against C1 recurring: ensure a shell-scope
    // `export JAVA_TOOL_OPTIONS=...` doesn't sneak back in. The
    // env-prefix form above is the ONLY acceptable scoping.
    test('does NOT export JAVA_TOOL_OPTIONS at shell scope (would leak into gradlew)', () => {
      // Match `export JAVA_TOOL_OPTIONS` anchored at line-start so
      // comments mentioning the identifier don't false-positive. The
      // `env` prefix on the operative line doesn't match this pattern.
      expect(scriptText).not.toMatch(/^export JAVA_TOOL_OPTIONS=/m);
    });

    // start.sh has a later `./gradlew` invocation (Step 7). Verify
    // the firebase emulator launch precedes it, since the env-scoping
    // depends on order: if gradlew ran first, env-prefix on a later
    // command can't retroactively scope. Match the operative lines
    // (the `env ... firebase emulators:start` line and the actual
    // `cd ... && ./gradlew ...` line) rather than bare substrings,
    // since both names also appear in comments earlier in the file.
    test('the env-prefixed firebase launch runs before any gradlew invocation', () => {
      // Operative firebase line: starts with `env ` at column 0.
      const firebaseMatch = scriptText.match(
        /^env JAVA_TOOL_OPTIONS=.*npx firebase emulators:start/m,
      );
      // Operative gradlew line: `./gradlew` preceded by whitespace
      // OR `&&` — i.e. actual shell command, not a comment word.
      const gradlewMatch = scriptText.match(/(?:&&|\s)\.\/gradlew\b/);
      expect(firebaseMatch).not.toBeNull();
      if (gradlewMatch !== null) {
        expect(firebaseMatch.index).toBeLessThan(gradlewMatch.index);
      }
    });
  });
});
