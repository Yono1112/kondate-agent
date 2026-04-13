#!/bin/bash
# PreToolUse hook: git commit 前にシークレット漏洩を検出する
#
# staged された変更の追加行に API キーや token のパターンが
# 含まれていないかチェックする。検出時は exit 2 でブロックする。

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

# staged ファイルの差分（追加行のみ）を取得
DIFF_ADDITIONS=$(git diff --cached 2>/dev/null | grep "^+" | grep -v "^+++")

if [ -z "$DIFF_ADDITIONS" ]; then
  exit 0
fi

FOUND=""

check_pattern() {
  local label="$1"
  local pattern="$2"
  local match
  match=$(echo "$DIFF_ADDITIONS" | grep -E "$pattern" | grep -v '=\s*$' | grep -v '=\s*your-' | grep -v '=\s*\$' | head -2)
  if [ -n "$match" ]; then
    FOUND="$FOUND [$label]"
  fi
}

check_pattern "LINE_CHANNEL_ACCESS_TOKEN" "LINE_CHANNEL_ACCESS_TOKEN=.{10,}"
check_pattern "LINE_CHANNEL_SECRET"       "LINE_CHANNEL_SECRET=.{10,}"
check_pattern "ZAI_API_KEY"               "ZAI_API_KEY=.{10,}"
check_pattern "秘密鍵"                    "\-\-\-\-\-BEGIN.*(PRIVATE|RSA)"
check_pattern "Bearer token"              "Bearer [a-zA-Z0-9+/=]{30,}"

if [ -z "$FOUND" ]; then
  exit 0
fi

# シークレット検出時はブロック（exit 2 + stderr）
echo "🚨 シークレットの可能性がある文字列が staged に含まれています！ 検出:$FOUND" >&2
exit 2
