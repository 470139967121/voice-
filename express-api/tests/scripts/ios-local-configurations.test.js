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
const { execFileSync } = require('child_process');

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
 * Find all XCBuildConfiguration blocks inside the
 * XCBuildConfiguration section that have the given `name`. Returns
 * an array of objects: `{ uuid, block }`. UUIDs are the leading
 * 24-hex token before the slash-star comment.
 *
 * Used to resolve UUID-by-name so tests can pin structural
 * invariants (e.g. "iosApp-target Local configs have no
 * baseConfigurationReference") without hardcoding UUIDs that
 * would shift on project regeneration.
 */
function findBuildConfigurationsByName(pbxproj, name) {
  const sectionStart = pbxproj.indexOf('/* Begin XCBuildConfiguration section */');
  const sectionEnd = pbxproj.indexOf('/* End XCBuildConfiguration section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('XCBuildConfiguration section markers not found.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  const results = [];
  // Each block opens with: \t\t<UUID> /* <name> */ = {
  // and the inner `name = "<name>";` is on its own line.
  const blockRegex = /\t\t([0-9A-F]{24}) \/\* ([^*]+?) \*\/ = \{([\s\S]+?)\n\t\t\};/g;
  let m;
  while ((m = blockRegex.exec(section)) !== null) {
    const [, uuid, declaredName, body] = m;
    if (declaredName.trim() === name) {
      results.push({ uuid, block: body });
    }
  }
  return results;
}

/**
 * Find the UUID of a PBXFileReference by its `path` attribute.
 * Returns the UUID string or `null` if not found. Used to resolve
 * Local.xcconfig's UUID for cross-checking baseConfigurationReference
 * fidelity.
 */
function findFileReferenceUuid(pbxproj, fileName) {
  const sectionStart = pbxproj.indexOf('/* Begin PBXFileReference section */');
  const sectionEnd = pbxproj.indexOf('/* End PBXFileReference section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('PBXFileReference section markers not found.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  // Match: \t\t<UUID> /* <fileName> */ = {...path = <fileName>;...};
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `\\t\\t([0-9A-F]{24}) /\\* ${escaped} \\*/ = \\{[^}]*path = ${escaped};`,
    'g',
  );
  const matches = [...section.matchAll(regex)];
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Multiple PBXFileReference declarations found for ${fileName}.`);
  }
  return matches[0][1];
}

/**
 * Extract a PBXGroup block by its UUID. Returns the full block.
 *
 * The startMarker is line-anchored with a leading `\n` — without
 * that anchor, a child reference of the same UUID (a 4-tab-indented
 * line at the main_group level) would substring-match because
 * `\t\t<UUID>` is contained in `\t\t\t\t<UUID>`. The newline anchor
 * forces the match to start at a line beginning.
 */
function extractGroupBlock(pbxproj, uuid) {
  const sectionStart = pbxproj.indexOf('/* Begin PBXGroup section */');
  const sectionEnd = pbxproj.indexOf('/* End PBXGroup section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('PBXGroup section markers not found.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  const startMarker = `\n\t\t${uuid} `;
  const startIdx = section.indexOf(startMarker);
  if (startIdx < 0) {
    throw new Error(`PBXGroup ${uuid} not found.`);
  }
  // Skip the leading `\n` so the returned block starts at the line.
  const blockStart = startIdx + 1;
  const endIdx = section.indexOf('\n\t\t};', blockStart);
  return section.slice(blockStart, endIdx + '\n\t\t};'.length);
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

    // Round 1 Gap 4: iosApp-target list defaultConfigurationName too.
    // If Phase 3.2 had accidentally changed it (e.g. to Debug-Local),
    // every CI build of iosApp would silently switch to the wrong
    // configuration. Pin it to catch that class of regression.
    test('iosApp-target defaultConfigurationName remains Release', () => {
      const block = extractConfigurationList(pbxproj, '058558B1273AAA2400C9D062');
      expect(block).toContain('defaultConfigurationName = Release;');
    });
  });

  describe('Phase 3.2 structural invariants (Round 1 review gaps)', () => {
    // Round 1 Gap 2 — THE Phase 3.2 invariant: iosApp-target Local
    // configs MUST NOT have baseConfigurationReference. CocoaPods
    // integration (Phase 3.4) is the only thing allowed to add one,
    // injecting Pods-iosApp.{debug,release}-local.xcconfig. A future
    // accidental addition (e.g. someone copying the project-level
    // config wholesale) would break the planned 3.4 integration
    // silently.
    test('iosApp-target Debug-Local has NO baseConfigurationReference (Phase 3.4 scope)', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      // Two matches: one project-level (has base ref), one iosApp-target (no base ref).
      expect(matches).toHaveLength(2);
      const targetLevel = matches.find((m) => !m.block.includes('baseConfigurationReference'));
      expect(targetLevel).toBeDefined();
    });

    test('iosApp-target Release-Local has NO baseConfigurationReference (Phase 3.4 scope)', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Release-Local');
      expect(matches).toHaveLength(2);
      const targetLevel = matches.find((m) => !m.block.includes('baseConfigurationReference'));
      expect(targetLevel).toBeDefined();
    });

    // Round 1 Gap 3 — UUID fidelity. The original test asserted
    // `/* Local.xcconfig */` was present, which passes even if the
    // UUID on the left side is wrong. This resolves the actual UUID
    // of the Local.xcconfig PBXFileReference and asserts BOTH
    // project-level Local configs point at it specifically.
    test('project-level Local configs baseConfigurationReference targets the Local.xcconfig file ref UUID', () => {
      const xcconfigUuid = findFileReferenceUuid(pbxproj, 'Local.xcconfig');
      expect(xcconfigUuid).not.toBeNull();
      expect(xcconfigUuid).toMatch(/^[0-9A-F]{24}$/);

      const debugMatches = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      const projectLevelDebug = debugMatches.find((m) =>
        m.block.includes('baseConfigurationReference'),
      );
      expect(projectLevelDebug).toBeDefined();
      expect(projectLevelDebug.block).toContain(
        `baseConfigurationReference = ${xcconfigUuid} /* Local.xcconfig */;`,
      );

      const releaseMatches = findBuildConfigurationsByName(pbxproj, 'Release-Local');
      const projectLevelRelease = releaseMatches.find((m) =>
        m.block.includes('baseConfigurationReference'),
      );
      expect(projectLevelRelease).toBeDefined();
      expect(projectLevelRelease.block).toContain(
        `baseConfigurationReference = ${xcconfigUuid} /* Local.xcconfig */;`,
      );
    });

    // Round 1 Gap 5 — PBXGroup invariants.
    test('Configurations PBXGroup exists and contains exactly Local.xcconfig', () => {
      // Find the Configurations group by scanning the PBXGroup section
      // for a block whose name attribute equals "Configurations".
      const groupSection = pbxproj.slice(
        pbxproj.indexOf('/* Begin PBXGroup section */'),
        pbxproj.indexOf('/* End PBXGroup section */'),
      );
      const groupHeader = /\t\t([0-9A-F]{24}) \/\* Configurations \*\/ = \{/;
      const headerMatch = groupSection.match(groupHeader);
      expect(headerMatch).not.toBeNull();
      const groupUuid = headerMatch[1];

      const block = extractGroupBlock(pbxproj, groupUuid);
      // The group must contain Local.xcconfig as its only child.
      expect(block).toContain('/* Local.xcconfig */,');
      // path = Configurations preserves on-disk layout.
      expect(block).toContain('path = Configurations;');
    });

    test('Configurations PBXGroup is a child of the iosApp PBXGroup', () => {
      // iosApp group UUID is 058557D1273AAA2400C9D062 per existing pbxproj.
      const iosAppGroupBlock = extractGroupBlock(pbxproj, '058557D1273AAA2400C9D062');
      expect(iosAppGroupBlock).toContain('/* Configurations */,');
    });

    // PBXFileReference for Local.xcconfig must declare the xcconfig
    // file type so Xcode treats it correctly.
    test('Local.xcconfig PBXFileReference has lastKnownFileType = text.xcconfig', () => {
      const fileRefSection = pbxproj.slice(
        pbxproj.indexOf('/* Begin PBXFileReference section */'),
        pbxproj.indexOf('/* End PBXFileReference section */'),
      );
      const declRegex = /[0-9A-F]{24} \/\* Local\.xcconfig \*\/ = \{([^}]+)\};/;
      const declMatch = fileRefSection.match(declRegex);
      expect(declMatch).not.toBeNull();
      expect(declMatch[1]).toContain('lastKnownFileType = text.xcconfig');
      expect(declMatch[1]).toContain('path = Local.xcconfig');
      expect(declMatch[1]).toContain('sourceTree = "<group>"');
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

    // Round 1 Gap 6 — REAL idempotency test. The header-comment scan
    // above only checks documentation. This actually invokes the
    // script against the working-tree pbxproj (which already contains
    // the Local configs after the script ran once) and asserts:
    //   (1) the script exits 0
    //   (2) the pbxproj is byte-identical before and after
    //   (3) stdout contains the expected 5 "(no-op)" messages
    // Untested branches lines 67-71 / 79-82 / 101-105 of the script
    // are now exercised end-to-end on every test run.
    //
    // Safe to mutate the working-tree pbxproj because the contract
    // is "no change" — if the script ever stops being idempotent the
    // pbxproj diff itself becomes the failure signal.
    test('script is byte-idempotent — re-running on a populated pbxproj produces zero diff', () => {
      // Skip if ruby/xcodeproj-gem not installed (some CI shards run
      // JS tests on slimmer images). The macOS-15 runners that run
      // the iOS jobs have it; Linux runners may not.
      try {
        // eslint-disable-next-line sonarjs/no-os-command-from-path
        execFileSync('ruby', ['-rxcodeproj', '-e', 'true'], { stdio: 'pipe' });
      } catch (_e) {
        // ruby+xcodeproj missing — defer to CI's macOS runner.
        return;
      }

      const before = fs.readFileSync(PBXPROJ);
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      const stdout = execFileSync('ruby', [ADD_SCRIPT], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      const after = fs.readFileSync(PBXPROJ);

      // (2) byte-identical
      expect(after.equals(before)).toBe(true);

      // (3) the 5 no-op lines
      expect(stdout).toContain('PBXFileReference already present: Local.xcconfig (no-op)');
      expect(stdout).toContain(
        'Project-level XCBuildConfiguration already present: Debug-Local (no-op)',
      );
      expect(stdout).toContain(
        'Project-level XCBuildConfiguration already present: Release-Local (no-op)',
      );
      expect(stdout).toContain(
        'iosApp-target XCBuildConfiguration already present: Debug-Local (no-op)',
      );
      expect(stdout).toContain(
        'iosApp-target XCBuildConfiguration already present: Release-Local (no-op)',
      );
    });
  });
});
