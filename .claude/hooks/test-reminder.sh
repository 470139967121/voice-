#!/bin/bash
# PostToolUse hook: remind to run tests after editing Kotlin or Express API files
FILE_PATH="${CLAUDE_FILE_PATH:-}"

if [[ "$FILE_PATH" == *.kt ]]; then
  echo "Reminder: run ./gradlew test"
elif [[ "$FILE_PATH" == *express-api/* ]]; then
  echo "Reminder: run cd express-api && npm test"
fi
# For all other files, output nothing (exit silently)
