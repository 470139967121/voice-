/**
 * Static contract test for `iosApp/iosApp/iosApp.entitlements`.
 *
 * iOS sign-in providers that go through `ASAuthorizationController`
 * require their corresponding entitlement keys in the .entitlements
 * plist — without them, the system framework returns an error from
 * `performRequests()` and the sign-in flow fails silently from the
 * user's perspective (Apple Sign-In sheet appears, then immediately
 * dismisses with no token).
 *
 * Apple Sign-In specifically: requires
 * `com.apple.developer.applesignin = ["Default"]`. Lost during a prior
 * cleanup of the entitlements file when push (`aps-environment`) was
 * the only key needed for an APNs-focused PR — Sign-In with Apple was
 * silently dropped and DEV TestFlight builds since then have failed
 * Apple Sign-In on first tap.
 *
 * Push notifications: still need `aps-environment` so leaving that
 * separate.
 *
 * The entitlements file is plain XML, so a string-contains check is
 * sufficient. We don't parse the plist because adding a Node plist
 * parser dep for a one-off contract test isn't worth it.
 */

const fs = require('node:fs');
const path = require('node:path');

const ENTITLEMENTS_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'iosApp',
  'iosApp',
  'iosApp.entitlements',
);

describe('iOS entitlements — auth provider keys', () => {
  let raw;

  beforeAll(() => {
    raw = fs.readFileSync(ENTITLEMENTS_PATH, 'utf8');
  });

  test('file exists and is non-empty', () => {
    expect(raw.length).toBeGreaterThan(0);
  });

  test('declares Apple Sign-In entitlement (com.apple.developer.applesignin)', () => {
    // Without this key the iOS app cannot present the Apple Sign-In
    // sheet — `ASAuthorizationController.performRequests()` returns
    // immediately with an error and no token. DEV TestFlight builds
    // were missing this key, breaking the user-facing Apple Sign-In
    // button on every screen.
    expect(raw).toContain('<key>com.apple.developer.applesignin</key>');
  });

  test('Apple Sign-In entitlement value is the Default array', () => {
    // The expected payload after the key is `<array><string>Default</string></array>`.
    // Apple's docs allow this exact value for first-party app sign-in.
    // Anything else (e.g. an empty array) is a misconfiguration.
    const re =
      /<key>com\.apple\.developer\.applesignin<\/key>\s*<array>\s*<string>Default<\/string>\s*<\/array>/;
    expect(raw).toMatch(re);
  });

  test('keeps push entitlement (aps-environment) so APNs still works', () => {
    // Regression guard: don't accidentally drop APNs setup while
    // adding Apple Sign-In.
    expect(raw).toContain('<key>aps-environment</key>');
  });
});
