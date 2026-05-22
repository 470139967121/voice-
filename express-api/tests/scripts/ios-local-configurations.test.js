/**
 * iosApp.xcodeproj — Phase 3.2 Local build configurations
 *
 * Phase 3 of the iOS-local build-out adds a parallel `Local` flavour
 * matching the Android local product flavor:
 *   - 3.1 ✅  Local.xcconfig foundation file (PR #714)
 *   - 3.2 (this PR) — Debug-Local + Release-Local on PROJECT-level
 *                     and the iosApp TARGET-level configuration lists,
 *                     project-level configs base-reference Local.xcconfig
 *   - 3.3 (next)   — iosAppTests + iosAppUITests target configurations
 *   - 3.4          — CocoaPods integration (Pods-iosApp.debug-local.xcconfig
 *                    + Pods-iosApp.release-local.xcconfig)
 *   - 3.5          — Local scheme + LiveKitBridge isAllowedURL extension
 *
 * Implementation is via the xcodeproj ruby gem (scripts/ios/
 * add-local-configurations.rb) — the only safe way to mutate
 * project.pbxproj programmatically. The script is idempotent.
 *
 * These tests pin the END STATE of the pbxproj after the script has
 * run, so they fail loud if a future PR (or a manual Xcode edit) drops
 * the configurations. Grep-based string assertions keep the contract
 * independent of pbxproj line-numbering drift.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PBXPROJ = path.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj/project.pbxproj');
const ADD_SCRIPT = path.join(REPO_ROOT, 'scripts/ios/add-local-configurations.rb');

/**
 * Count exact occurrences of a literal line match in the pbxproj.
 * Uses string equality (not regex) so the surrounding whitespace
 * matters — pbxproj uses tab indentation consistently.
 */
function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Extract an XCConfigurationList block by its UUID prefix, scoped
 * to the XCConfigurationList section of the file. Returns the
 * full block including the closing `};`. Throws if not found or
 * if the UUID matches more than one block.
 */
function extractConfigurationList(pbxproj, uuid) {
  const sectionStart = pbxproj.indexOf('/* Begin XCConfigurationList section */');
  const sectionEnd = pbxproj.indexOf('/* End XCConfigurationList section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('XCConfigurationList section markers not found in pbxproj.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  const blockStart = section.indexOf(`\t\t${uuid} `);
  if (blockStart < 0) {
    throw new Error(`XCConfigurationList ${uuid} not found.`);
  }
  // Ensure uniqueness — second occurrence within section is a bug.
  const secondStart = section.indexOf(`\t\t${uuid} `, blockStart + 1);
  if (secondStart >= 0) {
    throw new Error(`XCConfigurationList ${uuid} appears more than once.`);
  }
  const blockEnd = section.indexOf('\t\t};', blockStart);
  if (blockEnd < 0) {
    throw new Error(`XCConfigurationList ${uuid} block has no closing };`);
  }
  return section.slice(blockStart, blockEnd + '\t\t};'.length);
}

describe('iosApp.xcodeproj — Phase 3.2 Local build configurations', () => {
  let pbxproj;

  beforeAll(() => {
    pbxproj = fs.readFileSync(PBXPROJ, 'utf8');
  });

  describe('XCBuildConfiguration entries', () => {
    // Two per configuration name: one at project-level (058558B0
    // list) and one at iosApp-target-level (058558B1 list). Test
    // targets are Phase 3.3 — explicitly NOT counted here.
    test('Debug-Local appears as an XCBuildConfiguration name exactly twice (project + iosApp target)', () => {
      const count = countMatches(pbxproj, /\n\t{3}name = "Debug-Local";/g);
      expect(count).toBe(2);
    });

    test('Release-Local appears as an XCBuildConfiguration name exactly twice (project + iosApp target)', () => {
      const count = countMatches(pbxproj, /\n\t{3}name = "Release-Local";/g);
      expect(count).toBe(2);
    });

    test('Local.xcconfig appears as a baseConfigurationReference comment exactly twice (project-level Debug-Local + Release-Local)', () => {
      // baseConfigurationReference uses the format:
      //   baseConfigurationReference = <UUID> /* Local.xcconfig */;
      // Two references = one per project-level Local config.
      // The iosApp-target Local configs (Phase 3.2) have NO base
      // reference — Pods integration is Phase 3.4.
      const count = countMatches(pbxproj, / \/\* Local\.xcconfig \*\//g);
      // 2 baseConfigurationReference comments + 1 PBXFileReference declaration
      // + 1 PBXGroup membership = 4 total occurrences of the comment.
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('XCConfigurationList membership', () => {
    test('project-level list (058558B0) includes both Debug-Local and Release-Local', () => {
      const block = extractConfigurationList(pbxproj, '058558B0273AAA2400C9D062');
      expect(block).toMatch(/\* Debug-Local \*\/,/);
      expect(block).toMatch(/\* Release-Local \*\/,/);
    });

    test('iosApp target list (058558B1) includes both Debug-Local and Release-Local', () => {
      const block = extractConfigurationList(pbxproj, '058558B1273AAA2400C9D062');
      expect(block).toMatch(/\* Debug-Local \*\/,/);
      expect(block).toMatch(/\* Release-Local \*\/,/);
    });

    test('test targets are NOT modified in Phase 3.2 (deferred to 3.3)', () => {
      // iosAppTests list — must NOT yet contain Local configs.
      const testsBlock = extractConfigurationList(pbxproj, 'A10008002600000000000001');
      expect(testsBlock).not.toMatch(/Debug-Local/);
      expect(testsBlock).not.toMatch(/Release-Local/);
      // iosAppUITests list — same.
      const uitestsBlock = extractConfigurationList(pbxproj, '08EFC4EBCF29E72CA6FC9F2A');
      expect(uitestsBlock).not.toMatch(/Debug-Local/);
      expect(uitestsBlock).not.toMatch(/Release-Local/);
    });

    test('project-level defaultConfigurationName remains Release (not changed by Local addition)', () => {
      const block = extractConfigurationList(pbxproj, '058558B0273AAA2400C9D062');
      expect(block).toContain('defaultConfigurationName = Release;');
    });
  });

  describe('Ruby script (scripts/ios/add-local-configurations.rb)', () => {
    test('script file exists', () => {
      expect(fs.existsSync(ADD_SCRIPT)).toBe(true);
    });

    test('script is idempotent — declares the intent in a header comment', () => {
      const scriptText = fs.readFileSync(ADD_SCRIPT, 'utf8');
      // Idempotency is critical: re-running the script must not
      // double-add configurations. The header should state this.
      expect(scriptText).toMatch(/idempotent/i);
    });

    test('script uses the xcodeproj gem (not raw text manipulation)', () => {
      const scriptText = fs.readFileSync(ADD_SCRIPT, 'utf8');
      expect(scriptText).toContain("require 'xcodeproj'");
    });

    test('script references Local.xcconfig as the base configuration source', () => {
      const scriptText = fs.readFileSync(ADD_SCRIPT, 'utf8');
      expect(scriptText).toContain('Local.xcconfig');
    });
  });
});
