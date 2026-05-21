/**
 * Pins the iOS local-flavor Build Configuration file's existence
 * and key build-setting variables.
 *
 * This file is the foundation of the iOS-local flavor — a sibling of
 * the Android `local` product flavor declared in `app/build.gradle.kts`.
 * Like Android local, it points the app at:
 *   - localhost Express API (port 3000)
 *   - localhost LiveKit (port 7880)
 *   - The `demo-shytalk` Firebase Emulator project
 *   - A `.local` bundle-id suffix so it can be installed alongside the
 *     dev variant on a single device
 *
 * Phase 3.1 (this PR) adds the file in isolation — it is NOT yet
 * referenced by the Xcode project. Subsequent sub-PRs:
 *   3.2 — add Debug-Local + Release-Local build configurations to
 *         iosApp.xcodeproj that consume this xcconfig
 *   3.3 — add iosApp-Local scheme bound to the new configurations
 *   3.4 — add GoogleService-Info-Local.plist (demo-shytalk) and the
 *         AppDelegate / iOSApp.swift selection logic
 *   3.5 — CI integration: build + upload as `local-ios-ipa` artifact
 *
 * Splitting Phase 3 into incremental PRs minimises the blast radius
 * of pbxproj surgery in 3.2 — if that PR goes wrong it only affects
 * the build configurations, not the foundation values that 3.1 sets.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const XCCONFIG_PATH = path.join(REPO_ROOT, 'iosApp/Configurations/Local.xcconfig');

describe('iosApp/Configurations/Local.xcconfig', () => {
  let xcconfigText;

  beforeAll(() => {
    expect(fs.existsSync(XCCONFIG_PATH)).toBe(true);
    xcconfigText = fs.readFileSync(XCCONFIG_PATH, 'utf8');
  });

  test('file exists at the expected path', () => {
    // beforeAll already asserts existence; this test makes the
    // existence contract explicit at the suite level.
    expect(fs.existsSync(XCCONFIG_PATH)).toBe(true);
  });

  // Mirror of Android's `applicationIdSuffix = ".local"`. Allows the
  // local-flavor iOS app to be installed alongside the dev variant
  // on the same physical device for side-by-side comparison.
  test('declares BUNDLE_ID_SUFFIX = .local', () => {
    expect(xcconfigText).toMatch(/^BUNDLE_ID_SUFFIX\s*=\s*\.local$/m);
  });

  // Operator-overridable. Default `localhost` works on iOS Simulator
  // (shares the Mac's network namespace). For a physical iPhone the
  // operator must override to the Mac's local-network IP (mDNS .local
  // hostname or 192.168.x.y) at build time:
  //
  //   xcodebuild -configuration Debug-Local LOCAL_HOST=Macbook.local …
  //
  // Documented in this file's comment block; pinned at the variable
  // name level here, value (`localhost`) checked separately below.
  test('declares LOCAL_HOST variable (defaults to localhost)', () => {
    expect(xcconfigText).toMatch(/^LOCAL_HOST\s*=\s*localhost$/m);
  });

  test('declares LOCAL_API_BASE_URL pointing at LOCAL_HOST:3000', () => {
    // Express API runs on port 3000 in the local stack (per
    // local/start.sh Step 5). Variable interpolation `${LOCAL_HOST}`
    // is the xcconfig idiom — gets resolved at build time.
    expect(xcconfigText).toMatch(/^LOCAL_API_BASE_URL\s*=\s*http:\/\/\$\(LOCAL_HOST\):3000$/m);
  });

  test('declares LOCAL_LIVEKIT_URL pointing at LOCAL_HOST:7880', () => {
    // LiveKit Docker container exposes 7880 per local/docker-compose.yml.
    expect(xcconfigText).toMatch(/^LOCAL_LIVEKIT_URL\s*=\s*ws:\/\/\$\(LOCAL_HOST\):7880$/m);
  });

  test('declares LOCAL_FIREBASE_PROJECT_ID = demo-shytalk', () => {
    // Matches the `--project=demo-shytalk` flag in
    // `firebase emulators:start` (local/start.sh Step 2). The
    // `demo-` prefix is Firebase's emulator-only namespace.
    expect(xcconfigText).toMatch(/^LOCAL_FIREBASE_PROJECT_ID\s*=\s*demo-shytalk$/m);
  });
});
