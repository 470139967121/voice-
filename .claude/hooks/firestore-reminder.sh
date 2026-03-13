#!/bin/bash
set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")

if echo "$file_path" | grep -q 'firestore\.rules'; then
  echo "Reminder: Deploy updated Firestore rules with: npx firebase deploy --only firestore:rules"
fi
