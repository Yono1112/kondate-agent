#!/bin/bash
# PreToolUse hook: git commit 前に npm run build リマインダー
#
# src/mastra/index.ts が staged されている場合、
# npm run build を実行したか確認を促す。

INPUT=$(cat)

COMMAND=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', ''))
except:
    print('')
" 2>/dev/null)

# git commit コマンドでなければスキップ
if ! echo "$COMMAND" | grep -q "git commit"; then
  exit 0
fi

# staged ファイルを取得
STAGED=$(git diff --cached --name-only 2>/dev/null)

if [ -z "$STAGED" ]; then
  exit 0
fi

# src/mastra/index.ts が staged に含まれているか確認
if ! echo "$STAGED" | grep -q "src/mastra/index\.ts"; then
  exit 0
fi

MSG="🏗️ src/mastra/index.ts が変更されています。npm run build でビルドが通ることを確認してください。"

cat <<EOF
{
  "continue": true,
  "systemMessage": "$MSG"
}
EOF

exit 0
