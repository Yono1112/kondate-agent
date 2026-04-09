import { createTool } from '@mastra/core/tools';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { db } from '../db/client.js';

const receiptParserAgent = new Agent({
  id: 'receipt-parser',
  name: 'レシート解析エージェント',
  instructions:
    'あなたはレシート画像から食材リストを抽出する専門エージェントです。指定されたスキーマに従って構造化データを返してください。',
  model: 'zhipuai/glm-5v-turbo',
});

const receiptItemSchema = z
  .object({
    item_name: z.string().optional().describe('食材名'),
    name: z.string().optional().describe('食材名（item_nameの別名）'),
    price: z.number().nullable().optional().describe('価格（税込み円）'),
    quantity: z.number().optional().default(1).describe('数量'),
    unit: z.string().optional().default('個').describe('単位'),
    is_food: z.boolean().optional().default(true).describe('食材かどうか'),
  })
  .transform((v) => ({
    item_name: v.item_name ?? v.name ?? '',
    price: v.price ?? null,
    quantity: v.quantity,
    unit: v.unit,
    is_food: v.is_food,
  }));

const receiptResultSchema = z.object({
  store_name: z.string().nullable().optional().describe('店舗名'),
  items: z.array(receiptItemSchema),
});

export const parseReceiptTool = createTool({
  id: 'parse-receipt',
  description:
    'レシート画像を解析し、食材リストを抽出して在庫（inventory）と購入履歴（purchases）を自動更新します。',
  inputSchema: z.object({
    image_url: z
      .string()
      .describe('レシート画像のURL（LINE Content APIから取得したURL）'),
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
    const purchasedDate =
      purchased_at ?? new Date().toISOString().split('T')[0];

    // 画像URLから画像データを取得（LINE Content API URLの場合はアクセストークンが必要）
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
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // Zhipu GLM-4.6V-Flash でレシート解析
    const result = await receiptParserAgent.generate(
      [
        {
          role: 'user',
          content: [
            { type: 'image', image: dataUrl },
            {
              type: 'text',
              text: `このレシート画像から食材リストを抽出してください。

## 基本ルール
- 食材でないもの（レジ袋代、ポイント、割引行、値引行、消費税、小計以降の行、ボーナスポイント行）は is_food: false にしてください。
- 数量が不明な場合は 1 としてください。
- 単位は「個」「g」「ml」「本」「パック」「袋」「枚」「切れ」等を使ってください。

## 略称の展開（重要）
スーパーのレシートでは商品名が省略されています。以下のルールで正式な食材名に補完してください:
- 末尾が切り詰められるパターンが多い（例: スパゲッティ→スパ、エリンギ→エリ、担々麺→担）
- ブランド名プレフィックスは正式メーカー名への手がかりとして使う（商品名からは除外してよい）

## ブランド名辞書（サミット向け）
- SB = S&B食品（スパイス・調味料・パスタソース）→ 「SB生風味たらこ」= たらこパスタソース
- ホクレン = ホクレン農業協同組合連合会（片栗粉・小麦粉等）
- ユウキ = ユウキ食品（中華・エスニック系調味料）
- 日清 = 日清食品（麺類・即席食品）→ 「日清中華 汁なし担」= 汁なし担々麺
- くらし = くらし良好（サミットPBブランド）→ 「くらしカットエリ」= カットエリンギ
- 水彩の森 = サミットPB天然水（ブランド名がそのまま商品名）→ 食材名は「天然水」
- こくうま = 東海漬物のキムチブランド
- 丸鶏がら = 味の素の中華スープブランド

## 部門コード（左端の4桁数字）
商品カテゴリの推論に活用してください:
- 1100 = 青果（野菜・きのこ）
- 1300 = 精肉
- 1520 = 加工食品（常温: 乾物・調味料・飲料・麺類）
- 1580 = 日配品（冷蔵: 納豆・豆腐・卵・麺・デザート等）
- 4425 = パン・ベーカリー
例: 部門1520の「たらこ」は生鮮たらこではなく加工食品（パスタソース等）と判断できます。

## 数量の読み取り
- 商品名末尾の数字は個数・食数として quantity に設定（例: 「たまご白10」→ quantity: 10、「うどん5食」→ quantity: 5）
- 「2コX単198」のような複数購入行は直前の商品の quantity に反映`,
            },
          ],
        },
      ],
      {
        structuredOutput: { schema: receiptResultSchema },
      },
    );

    const receipt = result.object;
    if (!receipt) {
      return {
        success: false,
        message: 'レシートの解析結果が取得できませんでした',
        items: [],
        inventory_updated: 0,
      };
    }

    // 食材のみフィルタリング
    const foodItems = receipt.items.filter((item) => item.is_food && item.item_name);
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
        const currentQty = Number(existing.rows[0].quantity);
        await db.execute({
          sql: `UPDATE inventory SET quantity = ?, updated_at = datetime('now') WHERE name = ?`,
          args: [currentQty + item.quantity, item.item_name],
        });
      } else {
        const inventoryId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await db.execute({
          sql: `INSERT INTO inventory (id, name, quantity, unit, purchased_at) VALUES (?, ?, ?, ?, ?)`,
          args: [
            inventoryId,
            item.item_name,
            item.quantity,
            item.unit,
            purchasedDate,
          ],
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
