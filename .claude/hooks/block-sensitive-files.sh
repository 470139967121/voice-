#!/bin/bash
set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")

if [ -z "$file_path" ]; then
  exit 0
fi

if echo "$file_path" | grep -qiE '\.(env|pem|key)$|google-services\.json|credentials|service[-_]account'; then
  echo "BLOCKED: Sensitive file ($file_path) — edit manually outside Claude Code." >&2
  exit 2
fi
