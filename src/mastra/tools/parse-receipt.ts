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
    const mimeType =
      (imageResponse.headers.get('content-type') as
        | 'image/jpeg'
        | 'image/png'
        | 'image/webp') ?? 'image/jpeg';

    // Gemini 2.0 Flashでレシート解析
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
              mimeType,
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
