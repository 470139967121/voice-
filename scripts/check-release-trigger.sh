#!/usr/bin/env bash
# Verify release.yml is workflow_dispatch-only and never auto-fires on push.
#
# Background: every merge to main used to auto-bump the semver and create a
# tagged release. With small-PR cadence, that produced one "release" per
# unrelated change. The agreed flow is: merge freely to main, manually
# trigger Release when a stable batch is ready. This guard prevents the
# `push: branches: [main]` trigger from sneaking back in.
#
# Run from project root.

set -euo pipefail

RELEASE_YML=".github/workflows/release.yml"
DEPLOY_DEV_YML=".github/workflows/deploy-dev.yml"

if [ ! -f "$RELEASE_YML" ]; then
  echo "::error::$RELEASE_YML not found"
  exit 1
fi

# Parse the `on:` block. We accept workflow_dispatch and manual triggers
# only — no `push:` trigger of any kind. This deliberately rejects ALL
# push triggers, not just push-to-main, since any auto-fire-on-merge
# defeats the manual-release purpose.
#
# Use yq if available (more robust against YAML quirks), fall back to grep.
if command -v yq >/dev/null 2>&1; then
  triggers=$(yq '.on | keys | .[]' "$RELEASE_YML")
  if [ -z "$triggers" ]; then
    echo "::error::release.yml has no 'on:' triggers — workflow would be unreachable"
    exit 1
  fi
  while IFS= read -r trigger; do
    case "$trigger" in
      workflow_dispatch) ;;
      schedule) ;;
      *)
        echo "::error::release.yml has unsupported trigger '$trigger' — must be workflow_dispatch only"
        exit 1
        ;;
    esac
  done <<< "$triggers"
else
  # Grep-based check. Reject ANY occurrence of `push:` as a trigger key.
  # Catches all common forms:
  #   push:                          (block style)
  #   push:                          (then branches: under it)
  #     branches: [main]
  #   push: [main]                   (inline list)
  #   push: { branches: [main] }     (inline mapping)
  #   on: { push: { ... }, ... }     (fully-inline `on:`)
  # The pattern matches `push:` either at the start of an indented line
  # (block style) or anywhere inside a `{ ... }` after `on:`. We accept
  # the false-positive risk of matching `push:` inside a string literal
  # — release.yml has no such literals and the cost of a false positive
  # is just a clearer manual review.
  if grep -qE '^\s*push:\s*([\[{]|$)|on:\s*\{[^}]*\bpush:' "$RELEASE_YML"; then
    echo "::error::release.yml has a 'push:' trigger — must be workflow_dispatch only"
    grep -nE 'push:' "$RELEASE_YML" || true
    exit 1
  fi
fi

# Verify workflow_dispatch is present (otherwise the workflow can never fire).
if ! grep -qE '^\s*workflow_dispatch:' "$RELEASE_YML"; then
  echo "::error::release.yml is missing 'workflow_dispatch:' trigger — would be unreachable"
  exit 1
fi

# Verify deploy-dev.yml injects an iOS build number from GITHUB_RUN_NUMBER
# so each dev build gets a unique CFBundleVersion (TestFlight rejects
# duplicates). Without this, dropping the auto-release trigger leaves iOS
# stuck on whatever CFBundleVersion is committed in project.pbxproj.
if [ -f "$DEPLOY_DEV_YML" ]; then
  if ! grep -qE 'CFBundleVersion|CURRENT_PROJECT_VERSION' "$DEPLOY_DEV_YML"; then
    echo "::error::deploy-dev.yml does not bump CFBundleVersion / CURRENT_PROJECT_VERSION — iOS dev uploads will hit duplicate-build-number rejections from TestFlight"
    exit 1
  fi
  if ! grep -qE 'GITHUB_RUN_NUMBER|github\.run_number' "$DEPLOY_DEV_YML"; then
    echo "::error::deploy-dev.yml does not reference GITHUB_RUN_NUMBER for build numbering — iOS CFBundleVersion will not be unique per run"
    exit 1
  fi
fi

echo "✓ release.yml is workflow_dispatch-only; deploy-dev.yml injects unique iOS build number."
