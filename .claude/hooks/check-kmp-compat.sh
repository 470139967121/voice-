#!/usr/bin/env bash
# check-kmp-compat.sh — Bans JVM-only APIs in shared/src/commonMain.
#
# Used by: lint-staged (pre-commit) on `shared/src/commonMain/**/*.kt` files.
#
# Why: commonMain compiles for both Android (JVM) and iOS (Kotlin/Native).
# JVM-only APIs compile fine on Android but break iOS linking with
# unresolved references at the K/N stage — typically caught only by the
# slow `:shared:compileKotlinIosArm64` task. This hook fails the commit
# in <1s instead, surfacing the KMP-compat error at the moment a
# developer (or LLM agent) writes a JVM-ism in commonMain.
#
# Mirrors the rules from `kmp-compat-checker` agent + the project
# CLAUDE.md "KMP iOS Compatibility (commonMain)" section.
#
# Rules — flagged patterns and their KMP-safe replacements:
#   System.currentTimeMillis()  →  currentTimeMillis() from core.util.PlatformTime
#   System.nanoTime()           →  PlatformTime equivalent
#   Math.PI / Math.sin / etc.   →  kotlin.math.PI / kotlin.math.sin
#   String.format(...)          →  padStart() / manual formatting
#   synchronized {}             →  remove or use kotlinx.coroutines.sync.Mutex
#   @Volatile (un-prefixed)     →  @kotlin.concurrent.Volatile
#
# Usage:
#   bash .claude/hooks/check-kmp-compat.sh [file1.kt file2.kt ...]
#   If no args, scans all of shared/src/commonMain/**/*.kt.
#
# Exit codes:
#   0 — no violations
#   1 — at least one violation found

set -euo pipefail

ERRORS=0

# Collect files to check. Filter to shared/src/commonMain only — this
# hook is irrelevant for Android-only or iOS-only sources, and running
# it on every Kotlin file would produce false-positive noise.
if [ $# -gt 0 ]; then
  FILES=()
  for f in "$@"; do
    case "$f" in
      shared/src/commonMain/*.kt|shared/src/commonMain/**/*.kt)
        FILES+=("$f")
        ;;
    esac
  done
else
  # No args — full scan of commonMain. Used by CI lint job.
  while IFS= read -r f; do
    FILES+=("$f")
  done < <(find shared/src/commonMain -name '*.kt' -type f 2>/dev/null || true)
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  exit 0
fi

# Each rule is a (pattern, message, suggested-fix) triple. The pattern
# is a fixed string passed to grep -F so regex metacharacters in the
# Java API names (e.g. `.`) are matched literally rather than as wildcards.

check_rule() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  local fix="$4"
  # grep -nF: line numbers, fixed-string, no regex.
  # We exclude lines starting with `//` or inside `/*…*/` block-style
  # comments — the simplistic filter is good enough for KDoc comments
  # where a documented mention of the forbidden API legitimately
  # appears (e.g. "use this instead of `System.currentTimeMillis()`").
  # False-negatives on inline `// …` comments after code on the same
  # line are acceptable for this tradeoff.
  local matches
  matches=$(grep -nF "$pattern" "$file" 2>/dev/null \
    | grep -vE '^\s*[0-9]+:\s*(//|\*)' || true)
  if [ -n "$matches" ]; then
    echo "::error file=$file::KMP-compat: forbidden $label in commonMain"
    echo "$matches" | while IFS= read -r line; do
      echo "  $file:$line"
    done
    echo "  Fix: $fix"
    echo ""
    ERRORS=$((ERRORS + 1))
  fi
}

for file in "${FILES[@]}"; do
  [ -f "$file" ] || continue

  check_rule "$file" 'System.currentTimeMillis()' \
    'System.currentTimeMillis()' \
    'use currentTimeMillis() from com.shyden.shytalk.core.util.PlatformTime'

  check_rule "$file" 'System.nanoTime()' \
    'System.nanoTime()' \
    'use the KMP-safe equivalent in core.util.PlatformTime'

  check_rule "$file" 'Math.PI' \
    'Math.PI' \
    'use kotlin.math.PI'

  check_rule "$file" 'Math.sin(' \
    'Math.sin(' \
    'use kotlin.math.sin'

  check_rule "$file" 'Math.cos(' \
    'Math.cos(' \
    'use kotlin.math.cos'

  check_rule "$file" 'Math.sqrt(' \
    'Math.sqrt(' \
    'use kotlin.math.sqrt'

  check_rule "$file" 'String.format(' \
    'String.format(...)' \
    'use padStart() / manual formatting; String.format is JVM-only'

  # synchronized { ... } — match only the keyword followed by `{` so
  # `synchronizedListOf` (a real KMP function) is not flagged.
  check_rule "$file" 'synchronized {' \
    'synchronized {} block' \
    'remove or use kotlinx.coroutines.sync.Mutex'

  # `@Volatile` without the `kotlin.concurrent.` prefix is JVM-only.
  # The KMP-safe form is `@kotlin.concurrent.Volatile`. We grep for
  # the plain `@Volatile` and exclude lines that contain the prefixed
  # form on the same line (rare but possible in compound declarations).
  unprefixed_volatile=$(grep -n '@Volatile' "$file" 2>/dev/null \
    | grep -vF '@kotlin.concurrent.Volatile' \
    | grep -vE '^\s*[0-9]+:\s*(//|\*)' || true)
  if [ -n "$unprefixed_volatile" ]; then
    echo "::error file=$file::KMP-compat: bare @Volatile in commonMain"
    echo "$unprefixed_volatile" | while IFS= read -r line; do
      echo "  $file:$line"
    done
    echo "  Fix: replace with @kotlin.concurrent.Volatile (the KMP-safe form)"
    echo ""
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "$ERRORS KMP-compat violation(s) found in commonMain — fix them above before committing."
  echo "(Without this hook, the iOS compile failure would only surface"
  echo " during :shared:compileKotlinIosArm64, which takes ~1 minute.)"
  exit 1
fi

exit 0
