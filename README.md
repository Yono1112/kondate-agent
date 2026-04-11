# 献立エージェント (kondate-agent)

一人暮らしの自炊を支援するAIエージェント。毎日チャットで会話しながら、献立提案・食材在庫管理・食事記録を行います。

[Mastra](https://mastra.ai/) フレームワークで構築。

## 現在の実装状況

### Phase 1: 最小プロトタイプ (完了)

Mastra Studio上で動作する自炊アシスタントエージェント。

- 献立提案（在庫・履歴・ユーザー設定を考慮し、複数候補を提示）
- 食材在庫管理（追加・更新・削除・消費期限チェック）
- 食事記録（記録・履歴検索・在庫自動減算）
- ユーザー設定管理（優先度・家族構成・アレルギー・苦手な食材）

### Phase 2: LINE連携 (完了)

LINE Messaging APIを通じて、スマホから直接エージェントと対話できる。

- LINEでのテキスト対話（reply API使用）
- **献立提案をボタンテンプレートで提示**（send-line-buttons ツール）。候補をタップして選択できる
- **レシート画像送信 → 2段階解析**（店舗識別 → 店舗別プロンプト適用）→ 在庫・購入履歴に自動反映
  - サミット向けに部門コード・ブランド辞書を実装済み
- send-line ツールによるエージェントからの能動通知（push API）
- Webhook処理は背景化されており長時間処理でもLINE側のタイムアウトを発生させない
- 1ターン1メッセージルール（テキスト応答 or ボタン送信の一方のみ）

### 今後のフェーズ

| フェーズ | 内容 | 状態 |
|---------|------|------|
| Phase 3 | YouTuberレシピ取り込み・RAG検索 | 未着手 |
| Phase 4 | 自律実行・cron・Computer Useによるセール情報取得 | 未着手 |
| Phase 5 | ネットスーパー連携・Computer Useによる自動発注 | 未着手 |

## セットアップ

### 前提条件

- Node.js >= 22.13.0
- [Z.AI (Zhipu)](https://bigmodel.cn/) の API キー（GLM-5 / GLM-5V-Turbo を利用）
- LINE連携を使う場合: [LINE Developers Console](https://developers.line.biz/) でMessaging APIチャンネルを作成

### インストール

```bash
npm install
```

### 環境変数

`.env.example` を参考に `.env` を作成:

```
# LLM
ZAI_API_KEY=your-zai-api-key

# LINE Messaging API（Phase 2以降）
LINE_CHANNEL_ACCESS_TOKEN=your-channel-access-token
LINE_CHANNEL_SECRET=your-channel-secret
LINE_USER_ID=your-line-user-id
```

### 起動

```bash
npm run dev
```

ブラウザで http://localhost:4111 を開くと Mastra Studio が起動します。「自炊アシスタント」エージェントとチャットできます。

### LINEから利用する（Phase 2）

1. [LINE Developers Console](https://developers.line.biz/) でMessaging APIチャンネルを作成し、Channel secret / Access token を取得して `.env` に設定
2. 公開URLを用意（ローカル開発時は cloudflared / ngrok 等のトンネル）

   ```bash
   cloudflared tunnel --url http://localhost:4111
   ```

3. LINE Developers Console の Webhook URL に `https://<tunnel-domain>/webhooks/line` を設定し、「Webhookの利用」をオン
4. LINE Official Account Manager で「応答メッセージ」をオフ、「Webhook」をオン（応答モードは Bot）
5. LINEアプリでBotを友だち追加し、メッセージやレシート画像を送信

## アーキテクチャ

```
LINEアプリ ──webhook──┐         ┌── Mastra Studio (localhost:4111)
                     ↓         ↓
              Mastra API server (Hono)
                     │
              Mastra Agent
            「自炊アシスタント」(Z.AI GLM-5)
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
    ツール群     Mastra Memory     receipt-parser sub-agent
        │       （会話履歴）         (Z.AI GLM-5V-Turbo)
        ↓
   LibSQL (ローカルファイルDB)
```

## プロジェクト構成

```
src/mastra/
├── index.ts                    # Mastraエントリポイント (LINE webhook登録含む)
├── agents/
│   └── kondate-agent.ts        # 自炊アシスタントエージェント
├── db/
│   ├── client.ts               # LibSQLクライアント
│   ├── schema.ts               # テーブル定義 (inventory, meals, preferences, purchases)
│   └── seed.ts                 # 初期データ投入
├── tools/
│   ├── manage-inventory.ts       # 食材在庫管理 (追加/更新/削除/一覧)
│   ├── check-expiry.ts           # 消費期限チェック
│   ├── record-meal.ts            # 食事記録 (在庫自動減算)
│   ├── search-meals.ts           # 食事履歴検索
│   ├── manage-preferences.ts     # ユーザー設定管理
│   ├── suggest-menu.ts           # 献立コンテキスト取得
│   ├── send-line.ts              # LINE Push API送信（能動通知用）
│   ├── send-line-buttons.ts      # LINE Buttons Template送信（献立候補選択UI）
│   ├── parse-receipt.ts          # レシート画像解析 → 在庫/購入履歴更新
│   └── receipt-store-prompts.ts  # 店舗別レシート解析プロンプト定義
├── utils/
│   ├── dbSchemas.ts            # Zodスキーマ + DBパーサー関数
│   ├── dateUtils.ts            # 日付計算ユーティリティ
│   ├── lineClient.ts           # LINE SDKクライアント初期化
│   └── preferences.ts          # preferences行→オブジェクト変換
└── webhooks/
    └── line-webhook.ts         # LINE Messaging API Webhook
```

## ツール一覧

| ツール | 説明 |
|--------|------|
| `manage-inventory` | 食材在庫の追加・更新・削除・一覧取得 |
| `check-expiry` | 消費期限が近い食材の警告（デフォルト3日以内） |
| `record-meal` | 食事記録。使った食材の在庫を自動で減算 |
| `search-meals` | 期間・キーワードによる食事履歴検索 |
| `manage-preferences` | ユーザー設定の取得・更新（優先度・アレルギー等） |
| `suggest-menu` | 在庫・履歴・設定・期限情報を集約し、エージェントが献立を提案するためのコンテキストを提供 |
| `send-line` | LINE Push APIでユーザーに能動的にメッセージを送信 |
| `send-line-buttons` | LINE Buttons Templateで選択肢ボタン付きメッセージを送信（献立提案時に使用） |
| `parse-receipt` | レシート画像を2段階解析（店舗識別→店舗別プロンプト適用）し、食材を在庫・購入履歴に自動追加 |

## 使い方の例

```
ユーザー: 鶏むね肉500g、消費期限は4/8で在庫に追加して
エージェント: 鶏むね肉500gを在庫に追加しました！

ユーザー: 今日の夕飯を提案して
エージェント: 在庫の鶏むね肉を使った提案です！
  1. 鶏むね肉の照り焼き
  2. 鶏むね肉とブロッコリーの中華炒め
  3. しっとり茹で鶏のねぎ塩だれ

ユーザー: 1番目にする。記録して
エージェント: 鶏むね肉の照り焼きを夕食として記録しました！（在庫も自動更新済み）
```

## コマンド

```bash
npm run test    # ユニットテスト実行 (vitest)
npm run dev     # Mastra Studio起動 (localhost:4111)
npm run build   # プロダクションビルド
npm run start   # ビルド済みサーバー起動
```

## 技術スタック

- [Mastra](https://mastra.ai/) (`@mastra/core` v1.21+) — AIエージェントフレームワーク
- [Z.AI GLM-5 / GLM-5V-Turbo](https://bigmodel.cn/) — メイン/Vision LLM
- [@line/bot-sdk](https://github.com/line/line-bot-sdk-nodejs) — LINE Messaging API
- [LibSQL](https://github.com/tursodatabase/libsql) — ローカルファイルDB
- [Zod](https://zod.dev/) v4 — スキーマバリデーション
- [Vitest](https://vitest.dev/) — ユニットテスト
- TypeScript (ES2022)
