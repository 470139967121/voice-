#!/usr/bin/env bash
# E2E Test Matrix Runner
# Boots each AVD headless, runs connectedDebugAndroidTest, collects results.
# Usage: bash scripts/run_e2e_matrix.sh

set -euo pipefail

EMULATOR="/c/Users/saste/AppData/Local/Android/Sdk/emulator/emulator.exe"
ADB="/c/Users/saste/AppData/Local/Android/Sdk/platform-tools/adb.exe"
PROJECT_DIR="/c/Users/saste/AndroidStudioProjects/ShyTalk"
RESULTS_DIR="$PROJECT_DIR/e2e_results"
SUMMARY_FILE="$RESULTS_DIR/matrix_summary.txt"

mkdir -p "$RESULTS_DIR"

# All 42 AVDs in our matrix
AVDS=(
  Small_Phone_API_28 Medium_Phone_API_28 Large_Phone_API_28 Small_Tablet_API_28 Medium_Tablet_API_28 Large_Tablet_API_28
  Small_Phone_API_29 Medium_Phone_API_29 Large_Phone_API_29 Small_Tablet_API_29 Medium_Tablet_API_29 Large_Tablet_API_29
  Small_Phone_API_30 Medium_Phone_API_30 Large_Phone_API_30 Small_Tablet_API_30 Medium_Tablet_API_30 Large_Tablet_API_30
  Small_Phone_API_31 Medium_Phone_API_31 Large_Phone_API_31 Small_Tablet_API_31 Medium_Tablet_API_31 Large_Tablet_API_31
  Small_Phone_API_33 Medium_Phone_API_33 Large_Phone_API_33 Small_Tablet_API_33 Medium_Tablet_API_33 Large_Tablet_API_33
  Small_Phone_API_34 Medium_Phone_API_34 Large_Phone_API_34 Small_Tablet_API_34 Medium_Tablet_API_34 Large_Tablet_API_34
  Small_Phone_API_35 Medium_Phone_API_35 Large_Phone_API_35 Small_Tablet_API_35 Medium_Tablet_API_35 Large_Tablet_API_35
)

TOTAL=${#AVDS[@]}
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

echo "============================================" | tee "$SUMMARY_FILE"
echo "  E2E Test Matrix — $(date)" | tee -a "$SUMMARY_FILE"
echo "  Total AVDs: $TOTAL" | tee -a "$SUMMARY_FILE"
echo "============================================" | tee -a "$SUMMARY_FILE"
echo "" | tee -a "$SUMMARY_FILE"

for i in "${!AVDS[@]}"; do
  AVD="${AVDS[$i]}"
  IDX=$((i + 1))
  LOG_FILE="$RESULTS_DIR/${AVD}.log"

  echo "[$IDX/$TOTAL] === $AVD ===" | tee -a "$SUMMARY_FILE"
  echo "  Starting emulator..." | tee -a "$SUMMARY_FILE"

  # Kill any running emulator first
  "$ADB" emu kill 2>/dev/null || true
  sleep 2

  # Boot emulator headless
  "$EMULATOR" -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot -wipe-data &
  EMU_PID=$!

  # Wait for boot (max 180 seconds)
  BOOT_TIMEOUT=180
  BOOT_ELAPSED=0
  BOOTED=false
  while [ $BOOT_ELAPSED -lt $BOOT_TIMEOUT ]; do
    BOOT_STATUS=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || echo "")
    if [ "$BOOT_STATUS" = "1" ]; then
      BOOTED=true
      break
    fi
    sleep 5
    BOOT_ELAPSED=$((BOOT_ELAPSED + 5))
  done

  if [ "$BOOTED" = false ]; then
    echo "  SKIP — emulator failed to boot within ${BOOT_TIMEOUT}s" | tee -a "$SUMMARY_FILE"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    kill $EMU_PID 2>/dev/null || true
    "$ADB" emu kill 2>/dev/null || true
    sleep 5
    continue
  fi

  echo "  Booted in ${BOOT_ELAPSED}s. Running tests..." | tee -a "$SUMMARY_FILE"

  # Unlock screen and dismiss any setup wizards
  "$ADB" shell input keyevent 82 2>/dev/null || true
  sleep 2

  # Run tests
  cd "$PROJECT_DIR"
  if ./gradlew connectedDebugAndroidTest > "$LOG_FILE" 2>&1; then
    echo "  PASS" | tee -a "$SUMMARY_FILE"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    # Extract failure count from log
    FAILURES=$(grep -oP 'Tests run: \d+, Failures: \K\d+' "$LOG_FILE" 2>/dev/null | tail -1 || echo "?")
    echo "  FAIL (failures: $FAILURES)" | tee -a "$SUMMARY_FILE"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  # Copy test report
  REPORT_SRC="$PROJECT_DIR/app/build/reports/androidTests/connected"
  REPORT_DST="$RESULTS_DIR/reports_${AVD}"
  if [ -d "$REPORT_SRC" ]; then
    cp -r "$REPORT_SRC" "$REPORT_DST" 2>/dev/null || true
  fi

  # Shut down emulator
  echo "  Shutting down emulator..." | tee -a "$SUMMARY_FILE"
  "$ADB" emu kill 2>/dev/null || true
  sleep 5
  # Make sure process is dead
  kill $EMU_PID 2>/dev/null || true
  wait $EMU_PID 2>/dev/null || true
  sleep 3

  echo "" | tee -a "$SUMMARY_FILE"
done

echo "============================================" | tee -a "$SUMMARY_FILE"
echo "  RESULTS SUMMARY" | tee -a "$SUMMARY_FILE"
echo "  Total: $TOTAL | Pass: $PASS_COUNT | Fail: $FAIL_COUNT | Skip: $SKIP_COUNT" | tee -a "$SUMMARY_FILE"
echo "============================================" | tee -a "$SUMMARY_FILE"

echo ""
echo "Full results in: $RESULTS_DIR"
echo "Summary: $SUMMARY_FILE"
