# 献立エージェント Phase 2 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LINEでエージェントと対話でき、レシート写真を送ると食材在庫が自動更新されるシステムを構築する

**Architecture:** `@line/bot-sdk` + MastraカスタムAPIルート（Webhook）+ send_line/parse_receiptツール + purchasesテーブル

**Tech Stack:** Mastra (`@mastra/core`), `@line/bot-sdk`, `@google/genai`（レシート解析）, LibSQL, TypeScript ES2022

**Spec:** `docs/superpowers/specs/2026-04-05-kondate-agent-phase2-design.md`

**Status: ✅ 完了 (2026-04-07)**

---

## 進捗サマリー

全9タスク完了。LINEからのテキスト対話・レシート画像解析が実機で動作確認済み。

### 計画からの差分・追加対応

設計時から以下の点で実装が変わった/追加された:

1. **レシート解析モデル**: Gemini 2.0 Flash → Zhipu GLM-5V-Turbo に変更
   - Geminiの無料枠が枯渇したため切替
   - `generateObject` (AI SDK直接) → Mastra Agent + `structuredOutput` パターンに変更
   - GLMがフィールド名 `name` を返す揺れに対応するためZodスキーマを `transform` で正規化
   - コミット: `974f21a`

2. **LINE webhook bug fix**: `webhook.validateSignature` ではなく `validateSignature` を直接importする必要があった
   - コミット: `ba3f4dc`

3. **Webhook処理の背景化**: レシート解析が長時間かかりLINE側がタイムアウト→再送する問題に対応
   - 受信後即200を返し、`Promise` を捨てて背景処理継続
   - コミット: `efba412`

4. **エージェントモデル**: `zai/glm-4.7-flash` → `zai/glm-5` にアップグレード
   - ツール選択や日本語応答の品質向上のため
   - コミット: `296be53`

5. **LINE出力フォーマット規約を instructions に追加**
   - Markdownを使わない、ツール呼び出し前後のナレーション禁止
   - LINEがMarkdown非対応かつ一括送信のため

6. **ユニットテスト追加**: send-line / parse-receipt / line-webhook の3テストファイル（計14テスト）
   - コミット: `f60757a`

7. **トンネリング**: ngrokではなく cloudflared (`trycloudflare.com`) を利用

### LINE料金プランに関する知見

無料コミュニケーションプランは月200通制限があるが、`replyMessage`（replyToken使用）は**カウント対象外**。`pushMessage`（`sendLineTool`含む）のみカウント対象。現状の実装はユーザー応答が `replyMessage` ベースなので、200通枠はエージェント能動通知（リマインダー等）専用に温存できる。

### 残課題（Phase 3以降に持ち越し）

- `sendLineTool` を使った能動通知の実機検証（リマインダー、献立提案push等）
- replyToken期限切れ時の挙動（30秒超え→pushフォールバック）の動作確認

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/mastra/db/schema.ts` | purchasesテーブル追加 |
| `src/mastra/tools/send-line.ts` | LINE Push APIでメッセージ送信 |
| `src/mastra/tools/parse-receipt.ts` | レシート画像解析 → 在庫自動更新 |
| `src/mastra/webhooks/line-webhook.ts` | LINE Webhookハンドラー |
| `src/mastra/agents/kondate-agent.ts` | send_line・parse_receiptツールを追加 |
| `src/mastra/index.ts` | カスタムAPIルート登録 |

---

## Task 1: 依存パッケージをインストール

- [x] **Step 1: @line/bot-sdkをインストール**

```bash
npm install @line/bot-sdk
```

- [x] **Step 2: インストール確認**

```bash
ls node_modules/@line/
```

Expected: `bot-sdk` ディレクトリが存在する

- [x] **Step 3: ビルド確認**

```bash
npm run build
```

Expected: 成功（エラーなし）

---

## Task 2: purchasesテーブルをDBスキーマに追加

**Files:**
- Modify: `src/mastra/db/schema.ts`

- [x] **Step 1: schema.tsにpurchasesテーブルを追加**

`src/mastra/db/schema.ts` の `executeMultiple` のSQL文字列に以下を追加:

```sql
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  store_name TEXT,
  item_name TEXT NOT NULL,
  price INTEGER,
  quantity REAL,
  unit TEXT,
  purchased_at TEXT NOT NULL,
  receipt_image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [x] **Step 2: DBマイグレーション確認**

```bash
npx tsx -e "import { seedDatabase } from './src/mastra/db/seed.js'; await seedDatabase(); console.log('DB migrated successfully');"
```

Expected: `DB migrated successfully`

- [x] **Step 3: ビルド確認**

```bash
npm run build
```

Expected: 成功

- [x] **Step 4: コミット**

```bash
git add src/mastra/db/schema.ts
git commit -m "feat: purchasesテーブルをDBスキーマに追加"
```

---

## Task 3: send_lineツール実装

**Files:**
- Create: `src/mastra/tools/send-line.ts`

- [x] **Step 1: send-line.tsを作成**

`src/mastra/tools/send-line.ts`:

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { messagingApi } from '@line/bot-sdk';

export const sendLineTool = createTool({
  id: 'send-line',
  description: 'LINEのPush APIを使ってユーザーにメッセージを送信します。',
  inputSchema: z.object({
    message: z.string().describe('送信するメッセージ'),
    user_id: z
      .string()
      .optional()
      .describe('送信先LINEユーザーID（省略時はLINE_USER_ID環境変数を使用）'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ message, user_id }) => {
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetUserId = user_id ?? process.env.LINE_USER_ID;

    if (!channelAccessToken) {
      return { success: false, message: 'LINE_CHANNEL_ACCESS_TOKEN が設定されていません' };
    }
    if (!targetUserId) {
      return { success: false, message: '送信先ユーザーIDが指定されていません（LINE_USER_ID を設定してください）' };
    }

    const client = new messagingApi.MessagingApiClient({ channelAccessToken });

    await client.pushMessage({
      to: targetUserId,
      messages: [{ type: 'text', text: message }],
    });

    return { success: true, message: 'LINEメッセージを送信しました' };
  },
});
```

- [x] **Step 2: ビルド確認**

```bash
npm run build
```

Expected: 成功

- [x] **Step 3: コミット**

```bash
git add src/mastra/tools/send-line.ts
git commit -m "feat: send_lineツールを実装"
```

---

## Task 4: parse_receiptツール実装

**Files:**
- Create: `src/mastra/tools/parse-receipt.ts`

- [x] **Step 1: parse-receipt.tsを作成**

`src/mastra/tools/parse-receipt.ts`:

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '../db/client.js';
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';

const receiptItemSchema = z.object({
  item_name: z.string().describe('食材名（曖昧な場合は正式名称に補完）'),
  price: z.number().nullable().describe('価格（税込み円）。不明な場合はnull'),
  quantity: z.number().describe('数量'),
  unit: z.string().describe('単位（個, g, ml, 本, パック等）'),
  is_food: z.boolean().describe('食材かどうか（袋代・ポイント等はfalse）'),
});

const receiptResultSchema = z.object({
  store_name: z.string().nullable().describe('店舗名。レシートから読み取れない場合はnull'),
  items: z.array(receiptItemSchema),
});

export const parseReceiptTool = createTool({
  id: 'parse-receipt',
  description:
    'レシート画像を解析し、食材リストを抽出して在庫（inventory）と購入履歴（purchases）を自動更新します。',
  inputSchema: z.object({
    image_url: z.string().describe('レシート画像のURL（LINE Content APIから取得したURL）'),
    store_name: z.string().optional().describe('店舗名（分かる場合）'),
    purchased_at: z
      .string()
      .optional()
      .describe('購入日（YYYY-MM-DD）。省略時は本日'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    items: z.array(
      z.object({
        item_name: z.string(),
        price: z.number().nullable(),
        quantity: z.number(),
        unit: z.string(),
      }),
    ),
    inventory_updated: z.number(),
  }),
  execute: async ({ image_url, store_name, purchased_at }) => {
    const purchasedDate = purchased_at ?? new Date().toISOString().split('T')[0];

    // 画像URLからBase64を取得（LINE Content API URLの場合はアクセストークンが必要）
    const imageResponse = await fetch(image_url, {
      headers: process.env.LINE_CHANNEL_ACCESS_TOKEN
        ? { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
        : {},
    });
    if (!imageResponse.ok) {
      return {
        success: false,
        message: `画像の取得に失敗しました: ${imageResponse.statusText}`,
        items: [],
        inventory_updated: 0,
      };
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageResponse.headers.get('content-type') ?? 'image/jpeg';

    // Gemini 3 Flashでレシート解析
    const { object: receipt } = await generateObject({
      model: google('gemini-2.0-flash'),
      schema: receiptResultSchema,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: base64,
              mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
            },
            {
              type: 'text',
              text: `このレシート画像から食材リストを抽出してください。
食材でないもの（レジ袋代、ポイント、割引、消費税等）は is_food: false にしてください。
品名が略称・省略形の場合は正式な食材名に補完してください（例: ムネ → 鶏むね肉）。
数量が不明な場合は 1 としてください。
単位は「個」「g」「ml」「本」「パック」「袋」「枚」「切れ」等を使ってください。`,
            },
          ],
        },
      ],
    });

    // 食材のみフィルタリング
    const foodItems = receipt.items.filter((item) => item.is_food);
    const resolvedStoreName = store_name ?? receipt.store_name ?? '不明';

    let inventoryUpdated = 0;

    for (const item of foodItems) {
      const purchaseId = `purchase-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      // 購入履歴に記録
      await db.execute({
        sql: `INSERT INTO purchases (id, store_name, item_name, price, quantity, unit, purchased_at, receipt_image_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          purchaseId,
          resolvedStoreName,
          item.item_name,
          item.price,
          item.quantity,
          item.unit,
          purchasedDate,
          image_url,
        ],
      });

      // 在庫に追加（同名食材があれば数量を加算）
      const existing = await db.execute({
        sql: 'SELECT id, quantity FROM inventory WHERE name = ?',
        args: [item.item_name],
      });

      if (existing.rows.length > 0) {
        const currentQty = existing.rows[0].quantity as number;
        await db.execute({
          sql: `UPDATE inventory SET quantity = ?, updated_at = datetime('now') WHERE name = ?`,
          args: [currentQty + item.quantity, item.item_name],
        });
      } else {
        const inventoryId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await db.execute({
          sql: `INSERT INTO inventory (id, name, quantity, unit, purchased_at) VALUES (?, ?, ?, ?, ?)`,
          args: [inventoryId, item.item_name, item.quantity, item.unit, purchasedDate],
        });
      }

      inventoryUpdated++;
    }

    return {
      success: true,
      message: `レシートから${foodItems.length}品の食材を検出し、在庫を更新しました`,
      items: foodItems.map((item) => ({
        item_name: item.item_name,
        price: item.price,
        quantity: item.quantity,
        unit: item.unit,
      })),
      inventory_updated: inventoryUpdated,
    };
  },
});
```

- [x] **Step 2: ビルド確認**

```bash
npm run build
```

Expected: 成功

- [x] **Step 3: コミット**

```bash
git add src/mastra/tools/parse-receipt.ts
git commit -m "feat: parse_receiptツールを実装（レシート画像解析 → 在庫自動更新）"
```

---

## Task 5: LINE Webhookハンドラーを実装

**Files:**
- Create: `src/mastra/webhooks/line-webhook.ts`

- [x] **Step 1: line-webhook.tsを作成**

`src/mastra/webhooks/line-webhook.ts`:

```typescript
import { registerApiRoute } from '@mastra/core/server';
import { webhook, messagingApi } from '@line/bot-sdk';

export const lineWebhookRoute = registerApiRoute('/webhooks/line', {
  method: 'POST',
  requiresAuth: false,
  handler: async (c) => {
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    if (!channelSecret || !channelAccessToken) {
      return c.json({ error: 'LINE credentials not configured' }, 500);
    }

    // 署名検証
    const signature = c.req.header('x-line-signature') ?? '';
    const rawBody = await c.req.text();

    if (!webhook.validateSignature(rawBody, channelSecret, signature)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const body = JSON.parse(rawBody) as webhook.WebhookRequestBody;
    const lineClient = new messagingApi.MessagingApiClient({ channelAccessToken });
    const mastra = c.get('mastra');
    const agent = mastra.getAgent('kondateAgent');

    // イベントを並列処理
    await Promise.all(
      body.events.map(async (event) => {
        if (event.type !== 'message') return;
        if (!('source' in event) || !event.source?.userId) return;

        const userId = event.source.userId;
        const replyToken = 'replyToken' in event ? event.replyToken : undefined;

        // テキストメッセージ
        if (event.message.type === 'text') {
          const userMessage = event.message.text;

          try {
            const response = await agent.generate(
              [{ role: 'user', content: userMessage }],
              {
                threadId: `line-${userId}`,
                resourceId: userId,
              },
            );

            const replyText = response.text ?? '申し訳ありません、応答を生成できませんでした。';

            if (replyToken) {
              await lineClient.replyMessage({
                replyToken,
                messages: [{ type: 'text', text: replyText.slice(0, 5000) }],
              });
            } else {
              await lineClient.pushMessage({
                to: userId,
                messages: [{ type: 'text', text: replyText.slice(0, 5000) }],
              });
            }
          } catch (error) {
            console.error('Agent generation error:', error);
            if (replyToken) {
              await lineClient.replyMessage({
                replyToken,
                messages: [{ type: 'text', text: 'エラーが発生しました。もう一度お試しください。' }],
              });
            }
          }
        }

        // 画像メッセージ（レシート）
        if (event.message.type === 'image') {
          const messageId = event.message.id;
          const imageUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`;

          try {
            const response = await agent.generate(
              [
                {
                  role: 'user',
                  content: `レシート画像が送られてきました。parse-receiptツールを使って解析してください。image_url: ${imageUrl}`,
                },
              ],
              {
                threadId: `line-${userId}`,
                resourceId: userId,
              },
            );

            const replyText = response.text ?? 'レシートを処理しました。';

            if (replyToken) {
              await lineClient.replyMessage({
                replyToken,
                messages: [{ type: 'text', text: replyText.slice(0, 5000) }],
              });
            } else {
              await lineClient.pushMessage({
                to: userId,
                messages: [{ type: 'text', text: replyText.slice(0, 5000) }],
              });
            }
          } catch (error) {
            console.error('Receipt parsing error:', error);
            if (replyToken) {
              await lineClient.replyMessage({
                replyToken,
                messages: [{ type: 'text', text: 'レシートの読み取りに失敗しました。もう一度お試しください。' }],
              });
            }
          }
        }
      }),
    );

    return c.json({ status: 'ok' });
  },
});
```

- [x] **Step 2: ビルド確認**

```bash
npm run build
```

Expected: 成功

- [x] **Step 3: コミット**

```bash
git add src/mastra/webhooks/line-webhook.ts
git commit -m "feat: LINE Webhookハンドラーを実装"
```

---

## Task 6: エージェントに新ツールを追加

**Files:**
- Modify: `src/mastra/agents/kondate-agent.ts`

- [x] **Step 1: kondate-agent.tsにsend_line・parse_receiptツールを追加**

`src/mastra/agents/kondate-agent.ts` に以下をインポート追加:

```typescript
import { sendLineTool } from '../tools/send-line.js';
import { parseReceiptTool } from '../tools/parse-receipt.js';
```

`tools` オブジェクトに追加:

```typescript
tools: {
  manageInventoryTool,
  checkExpiryTool,
  recordMealTool,
  searchMealsTool,
  managePreferencesTool,
  suggestMenuTool,
  sendLineTool,       // 追加
  parseReceiptTool,   // 追加
},
```

`instructions` に以下を追記:

```
## LINE連携
- レシート画像のURLが提供されたときは parse-receipt ツールを使って解析する
- エージェントから能動的にメッセージを送りたいときは send-line ツールを使う
```

- [x] **Step 2: ビルド確認**

```bash
npm run build
```

Expected: 成功

- [x] **Step 3: コミット**

```bash
git add src/mastra/agents/kondate-agent.ts
git commit -m "feat: エージェントにsend_line・parse_receiptツールを追加"
```

---

## Task 7: Mastraインスタンスにカスタムルートを登録

**Files:**
- Modify: `src/mastra/index.ts`

- [x] **Step 1: index.tsにWebhookルートを追加**

`src/mastra/index.ts` を以下に書き換える:

```typescript
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { kondateAgent } from './agents/kondate-agent.js';
import { seedDatabase } from './db/seed.js';
import { lineWebhookRoute } from './webhooks/line-webhook.js';

// DB初期化（テーブル作成・デフォルトデータ投入）
await seedDatabase();

export const mastra = new Mastra({
  agents: { kondateAgent },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: 'file:./mastra.db',
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  server: {
    apiRoutes: [lineWebhookRoute],
  },
});
```

- [x] **Step 2: ビルド確認**

```bash
npm run build
```

Expected: 成功

- [x] **Step 3: コミット**

```bash
git add src/mastra/index.ts
git commit -m "feat: MastraインスタンスにLINE Webhookルートを登録"
```

---

## Task 8: 環境変数の設定と動作確認

- [x] **Step 1: .env.exampleを更新**

`.env.example` に以下を追加:

```env
# LINE Messaging API
LINE_CHANNEL_ACCESS_TOKEN=your-channel-access-token
LINE_CHANNEL_SECRET=your-channel-secret
LINE_USER_ID=your-line-user-id
```

- [x] **Step 2: LINE Developers Consoleで設定**

1. [LINE Developers Console](https://developers.line.biz/console/) にアクセス
2. プロバイダーを作成 or 選択
3. Messaging APIチャンネルを作成
4. チャンネルシークレットを取得 → `LINE_CHANNEL_SECRET` に設定
5. チャンネルアクセストークンを発行 → `LINE_CHANNEL_ACCESS_TOKEN` に設定
6. LINE Official Account Manager でBotのユーザーIDを確認 → `LINE_USER_ID` に設定

- [x] **Step 3: .envに設定を追加**

`.env` ファイルに実際の値を設定する（コミットしないこと）

- [x] **Step 4: コミット（.env.exampleのみ）**

```bash
git add .env.example
git commit -m "chore: LINE連携の環境変数をenv.exampleに追加"
```

---

## Task 9: ローカルでLINE Webhookをテスト

- [x] **Step 1: Mastra Studioを起動**

```bash
npm run dev
```

- [x] **Step 2: ngrokでトンネルを作成**

別ターミナルで:

```bash
ngrok http 4111
```

Forwarding URLを確認（例: `https://xxxx.ngrok.io`）

- [x] **Step 3: LINE DevelopersでWebhook URLを設定**

Webhook URL: `https://xxxx.ngrok.io/webhooks/line`
「Webhookの利用」をオン → 「検証」ボタンでテスト

Expected: 「成功」と表示される

- [x] **Step 4: LINEアプリで動作確認**

1. QRコードでBotを友達追加
2. テキスト送信 → エージェントから返信が来る
3. レシート写真を送信 → 在庫更新の確認メッセージが来る

- [x] **Step 5: 最終コミット**

```bash
git add -A
git commit -m "feat: Phase 2完了 — LINE連携（対話・レシート読み取り）"
```
