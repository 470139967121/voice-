#!/bin/bash
set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")

if [ -z "$file_path" ]; then
  exit 0
fi

if echo "$file_path" | grep -qE 'package-lock\.json$|gradle\.lockfile$|yarn\.lock$|pnpm-lock\.yaml$'; then
  echo "BLOCKED: Lock files should only change via package managers, not manual edits." >&2
  exit 2
fi
