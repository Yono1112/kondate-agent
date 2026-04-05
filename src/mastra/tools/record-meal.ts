import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '../db/client.js';

export const recordMealTool = createTool({
  id: 'record-meal',
  description:
    '食事を記録します。使った食材の在庫を自動で減らします。',
  inputSchema: z.object({
    date: z.string().describe('日付（YYYY-MM-DD形式）'),
    meal_type: z
      .enum(['breakfast', 'lunch', 'dinner', 'snack'])
      .describe('食事タイプ'),
    dish_name: z.string().describe('料理名'),
    ingredients: z
      .array(
        z.object({
          name: z.string().describe('食材名'),
          quantity: z.number().describe('使用量'),
          unit: z.string().describe('単位'),
        }),
      )
      .describe('使用した食材リスト'),
    notes: z.string().optional().describe('メモ（任意）'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    meal_id: z.string(),
  }),
  execute: async ({ date, meal_type, dish_name, ingredients, notes }) => {
    const id = `meal-${crypto.randomUUID()}`;

    await db.execute({
      sql: `INSERT INTO meals (id, date, meal_type, dish_name, ingredients, notes) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        date,
        meal_type,
        dish_name,
        JSON.stringify(ingredients),
        notes ?? null,
      ],
    });

    // 在庫を自動で減らす
    for (const ingredient of ingredients) {
      await db.execute({
        sql: `UPDATE inventory
              SET quantity = MAX(0, quantity - ?),
                  updated_at = datetime('now')
              WHERE name = ?`,
        args: [ingredient.quantity, ingredient.name],
      });
    }

    // 在庫が0になったものを削除
    await db.execute('DELETE FROM inventory WHERE quantity <= 0');

    return {
      success: true,
      message: `${dish_name} を${meal_type}として記録しました`,
      meal_id: id,
    };
  },
});
