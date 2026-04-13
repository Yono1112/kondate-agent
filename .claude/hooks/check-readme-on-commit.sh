#!/bin/bash
# PreToolUse hook: git commit 時に README.md の更新漏れを警告する
#
# src/mastra/ または docs/ のファイルが staged されているのに
# README.md が staged されていない場合に警告を出す。

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

# src/mastra/ または docs/ のファイルが staged されているか確認
TRIGGER_FILES=$(echo "$STAGED" | grep -E "^(src/mastra/|docs/)")

if [ -z "$TRIGGER_FILES" ]; then
  exit 0
fi

# README.md が staged されているか確認
if echo "$STAGED" | grep -q "^README.md$"; then
  exit 0
fi

# 警告を JSON systemMessage として出力
MSG="⚠️ README.md が commit に含まれていません。src/mastra/ や docs/ の変更時は README.md も確認してください。"

cat <<EOF
{
  "continue": true,
  "systemMessage": "$MSG"
}
EOF

exit 0
