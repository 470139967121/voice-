#!/usr/bin/env ruby
# frozen_string_literal: true

# scripts/ios/add-local-configurations.rb
#
# Phase 3.2 of the iOS-local build-out: adds Debug-Local and
# Release-Local XCBuildConfigurations to iosApp.xcodeproj.
#
# Scope:
#   - PROJECT-level configuration list — both configs added, both
#     reference iosApp/Configurations/Local.xcconfig as their
#     baseConfigurationReference (the file added by PR #714).
#   - iosApp TARGET-level configuration list — both configs added,
#     no base reference (CocoaPods integration is Phase 3.4).
#   - The Local.xcconfig file itself is added as a PBXFileReference
#     under iosApp/Configurations/ if not already present.
#
# Out of scope (deferred to later sub-PRs):
#   - 3.3 — iosAppTests + iosAppUITests target configurations
#   - 3.4 — Pods-iosApp.{debug,release}-local.xcconfig generation
#   - 3.5 — Local scheme + LiveKitBridge.isAllowedURL extension
#
# THE SCRIPT IS IDEMPOTENT. Re-running on a project that already
# has the Local configurations is a no-op — each step checks for
# existing entries by name before adding. The xcodeproj gem
# guarantees deterministic UUID generation for the configurations
# (same name → same UUID across runs) so the resulting pbxproj
# diff is stable.
#
# Usage:
#   ruby scripts/ios/add-local-configurations.rb
#
# Verified by: express-api/tests/scripts/ios-local-configurations.test.js

require 'xcodeproj'

REPO_ROOT = File.expand_path('../..', __dir__)
PROJECT_PATH = File.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj')
XCCONFIG_PATH_ABS = File.join(REPO_ROOT, 'iosApp/Configurations/Local.xcconfig')
XCCONFIG_REL_TO_IOSAPP = 'Configurations/Local.xcconfig'
TARGET_NAME = 'iosApp'
NEW_CONFIG_NAMES = %w[Debug-Local Release-Local].freeze

unless File.exist?(XCCONFIG_PATH_ABS)
  abort "FATAL: Local.xcconfig not found at #{XCCONFIG_PATH_ABS}. " \
        'Phase 3.1 (PR #714) must be merged before Phase 3.2 can run.'
end

project = Xcodeproj::Project.open(PROJECT_PATH)

# ── 1. Ensure Local.xcconfig is a project file reference ──────────
# Looking for a child of the iosApp group named "Configurations"
# that contains "Local.xcconfig". If absent, create the group and
# add the file reference. Idempotent — both lookups skip on hit.
iosapp_group = project.main_group['iosApp'] ||
               raise("Could not find iosApp PBXGroup in project main_group.")

configs_group = iosapp_group.groups.find { |g| g.display_name == 'Configurations' }
if configs_group.nil?
  configs_group = iosapp_group.new_group('Configurations', 'Configurations')
  puts "Created PBXGroup: iosApp/Configurations"
end

xcconfig_ref = configs_group.files.find { |f| f.display_name == 'Local.xcconfig' }
if xcconfig_ref.nil?
  xcconfig_ref = configs_group.new_file('Local.xcconfig')
  xcconfig_ref.last_known_file_type = 'text.xcconfig'
  puts "Added PBXFileReference: Local.xcconfig"
else
  puts "PBXFileReference already present: Local.xcconfig (no-op)"
end

# ── 2. Add Debug-Local + Release-Local to PROJECT-level list ──────
# Project-level configs base-reference Local.xcconfig so variables
# declared there (BUNDLE_ID_SUFFIX, LOCAL_HOST, etc.) propagate to
# every target unless overridden. Skip if a config of the same
# name already exists.
NEW_CONFIG_NAMES.each do |name|
  existing = project.build_configuration_list.build_configurations.find { |c| c.name == name }
  if existing
    puts "Project-level XCBuildConfiguration already present: #{name} (no-op)"
    next
  end

  config = project.new(Xcodeproj::Project::Object::XCBuildConfiguration)
  config.name = name
  config.base_configuration_reference = xcconfig_ref
  config.build_settings = {} # explicit empty — required by the gem
  project.build_configuration_list.build_configurations << config
  puts "Added project-level XCBuildConfiguration: #{name}"
end

# ── 3. Add Debug-Local + Release-Local to iosApp target list ──────
# Target-level configs have NO base reference at 3.2 — CocoaPods
# integration in Phase 3.4 will inject Pods-iosApp.debug-local
# .xcconfig as the base. Until then, target configs inherit
# everything from the project-level configs.
iosapp_target = project.targets.find { |t| t.name == TARGET_NAME } ||
                raise("Could not find iosApp target in project.")

NEW_CONFIG_NAMES.each do |name|
  existing = iosapp_target.build_configuration_list.build_configurations.find { |c| c.name == name }
  if existing
    puts "iosApp-target XCBuildConfiguration already present: #{name} (no-op)"
    next
  end

  config = project.new(Xcodeproj::Project::Object::XCBuildConfiguration)
  config.name = name
  config.build_settings = {}
  iosapp_target.build_configuration_list.build_configurations << config
  puts "Added iosApp-target XCBuildConfiguration: #{name}"
end

project.save
puts "\nSaved iosApp.xcodeproj."
puts 'Run `xcodebuild -list -project iosApp/iosApp.xcodeproj` to verify.'
