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
食材でないもの（レジ袋代、ポイント、割引、消費税等）は is_food: false にしてください。
品名が略称・省略形の場合は正式な食材名に補完してください（例: ムネ → 鶏むね肉）。
数量が不明な場合は 1 としてください。
単位は「個」「g」「ml」「本」「パック」「袋」「枚」「切れ」等を使ってください。`,
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
        const currentQty = existing.rows[0].quantity as number;
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
