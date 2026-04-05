# 自炊アシスタントエージェント — Phase 2 設計書

## 概要

Phase 2ではLINE Messaging APIと連携し、ユーザーがLINEで自炊アシスタントと会話できるようにする。
さらにレシート画像をLINEで送るだけで食材在庫が自動更新される機能を実装する。

---

## 対象フェーズの目標

1. LINEでエージェントと対話できる（テキストメッセージの送受信）
2. LINEでレシート写真を送ると食材在庫が自動更新される
3. エージェントからLINEへプッシュ通知を送れる

---

## 技術方針

### LINE連携の実装方式

`@chat-adapter/line` は存在しないため、`@line/bot-sdk` を直接使用する。

```
LINE ──Webhook POST──→ /webhooks/line
                           │
                    署名検証（LINE SDK）
                           │
                    メッセージ種別の判定
                    ┌──────┴──────┐
                 テキスト       画像
                    │             │
              エージェント   parse_receipt
              に転送して      ツール実行
              応答取得
                    │             │
                    └──────┬──────┘
                     LINE Push APIで返信
```

### カスタムAPIルート

`registerApiRoute('/webhooks/line', ...)` でLINE Webhookエンドポイントを作成。
`requiresAuth: false` でLINEからのリクエストを認証なしで受け付ける。

---

## 新規実装コンポーネント

### テーブル追加

```sql
-- 購入履歴（レシートから取り込み）
purchases (
  id TEXT PRIMARY KEY,
  store_name TEXT,
  item_name TEXT NOT NULL,
  price INTEGER,
  quantity REAL,
  unit TEXT,
  purchased_at TEXT NOT NULL,
  receipt_image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```

### 新規ツール

| ツール名 | 機能 |
|---------|------|
| `send_line` | LINE Push APIでメッセージ送信 |
| `parse_receipt` | レシート画像を解析し食材リスト抽出 → 在庫自動更新 + 購入履歴記録 |

### 新規ファイル

| ファイル | 役割 |
|---------|------|
| `src/mastra/tools/send-line.ts` | send_lineツール |
| `src/mastra/tools/parse-receipt.ts` | parse_receiptツール |
| `src/mastra/webhooks/line-webhook.ts` | LINE Webhookハンドラー |

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/mastra/db/schema.ts` | purchasesテーブル追加 |
| `src/mastra/agents/kondate-agent.ts` | send_line・parse_receiptツールを追加 |
| `src/mastra/index.ts` | カスタムAPIルート（Webhookエンドポイント）を登録 |

---

## 環境変数

```env
# LINE Messaging API
LINE_CHANNEL_ACCESS_TOKEN=your-channel-access-token
LINE_CHANNEL_SECRET=your-channel-secret
LINE_USER_ID=your-line-user-id  # プッシュ通知の送信先（自分のユーザーID）
```

---

## send_lineツール設計

### 入力スキーマ

```typescript
z.object({
  message: z.string().describe('送信するメッセージ'),
  user_id: z.string().optional().describe('送信先ユーザーID（省略時は環境変数LINE_USER_IDを使用）'),
})
```

### 出力スキーマ

```typescript
z.object({
  success: z.boolean(),
  message: z.string(),
})
```

### 実装

`@line/bot-sdk` の `messagingApi.MessagingApiClient` を使ってPush APIを呼ぶ。

---

## parse_receiptツール設計

### 入力スキーマ

```typescript
z.object({
  image_url: z.string().describe('レシート画像のURL'),
  store_name: z.string().optional().describe('店舗名（分かる場合）'),
  purchased_at: z.string().optional().describe('購入日（YYYY-MM-DD）。省略時は本日'),
})
```

### 出力スキーマ

```typescript
z.object({
  success: z.boolean(),
  message: z.string(),
  items: z.array(z.object({
    item_name: z.string(),
    price: z.number().nullable(),
    quantity: z.number(),
    unit: z.string(),
  })),
  inventory_updated: z.number().describe('在庫に追加した件数'),
})
```

### 実装方針

- Gemini 3 Flashのマルチモーダル機能を使ってレシート画像を解析
- LLMに食材リストをJSON形式で抽出させる
- 食材でないもの（袋代、ポイント等）は除外
- 曖昧な品名（「ムネ」→「鶏むね肉」）はLLMが補完
- 抽出結果を `inventory` と `purchases` テーブルに記録

---

## LINE Webhookハンドラー設計

### エンドポイント

`POST /webhooks/line`

### 処理フロー

```typescript
// 1. LINE SDKで署名検証
// 2. イベント種別を判定
// 3. テキストメッセージ → エージェントに転送 → Push APIで返信
// 4. 画像メッセージ → 画像URL取得 → parse_receiptツール実行 → Push APIで返信
// 5. その他 → 無視
```

### スレッド管理

LINE のユーザーID（`source.userId`）をMastra Memoryの `threadId` として使用する。
これにより会話履歴が維持される。

---

## デプロイ方針

### Vercel（推奨）

```bash
npm i -g vercel
vercel
```

Vercel Functionsとして動作。`mastra build` でビルドして `vercel deploy`。

### ngrok（ローカル開発）

```bash
ngrok http 4111
```

発行されたURLを LINE Developers Console の Webhook URLに設定:
`https://xxxx.ngrok.io/webhooks/line`

---

## LINE Developers Console設定

1. LINE Developers Console でチャンネルを作成
2. Messaging API チャンネルを選択
3. Webhook URL に `https://your-domain/webhooks/line` を設定
4. Webhook の利用をオン
5. チャンネルアクセストークンを発行 → `LINE_CHANNEL_ACCESS_TOKEN`
6. チャンネルシークレットを確認 → `LINE_CHANNEL_SECRET`
