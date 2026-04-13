#!/bin/bash
# PostToolUse hook: Edit/Write 後の自動チェック
#
# src/mastra/ 配下の .ts ファイルが編集されたとき:
#   1. TypeScript 型チェック（tsc --noEmit）でエラーを即検知
#   2. tools/ または webhooks/ のファイルならテスト実行リマインダー

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except:
    print('')
" 2>/dev/null)

# src/mastra/ 配下の .ts ファイルでなければスキップ
if ! echo "$FILE_PATH" | grep -q "src/mastra/"; then
  exit 0
fi
if ! echo "$FILE_PATH" | grep -q "\.ts$"; then
  exit 0
fi

PROJECT_ROOT="/Users/yumaohno/Documents/kondate-agent"
cd "$PROJECT_ROOT" || exit 0

MESSAGES=""

# ---- 1. TypeScript 型チェック ----
TSC_OUTPUT=$(npx tsc --noEmit 2>&1 | grep -v "node_modules" | grep -v "^$" | grep -v "^npm warn" | head -20)

if [ -n "$TSC_OUTPUT" ]; then
  MESSAGES="🔴 TypeScript 型エラー検出。"
fi

# ---- 2. テスト実行リマインダー ----
if echo "$FILE_PATH" | grep -qE "src/mastra/(tools|webhooks)/"; then
  if ! echo "$FILE_PATH" | grep -q "__tests__"; then
    if [ -n "$MESSAGES" ]; then
      MESSAGES="$MESSAGES テストも忘れずに: npm run test"
    else
      MESSAGES="🧪 tools/webhooks を変更しました。テストを忘れずに: npm run test"
    fi
  fi
fi

if [ -z "$MESSAGES" ]; then
  exit 0
fi

# エスケープ処理（JSON安全に）
MESSAGES=$(echo "$MESSAGES" | sed 's/"/\\"/g')

cat <<EOF
{
  "continue": true,
  "systemMessage": "$MESSAGES"
}
EOF

exit 0
