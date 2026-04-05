import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '../db/client.js';

export const suggestMenuTool = createTool({
  id: 'suggest-menu',
  description:
    '献立を提案するためのコンテキスト情報を取得します。在庫・直近の食事履歴・ユーザー設定・消費期限が近い食材をまとめて返します。エージェントはこの情報をもとに3つ程度の献立候補を考えて提示してください。',
  inputSchema: z.object({
    meal_type: z
      .enum(['breakfast', 'lunch', 'dinner'])
      .describe('食事タイプ'),
    additional_request: z
      .string()
      .optional()
      .describe('追加のリクエスト（例:「今日は手軽なのがいい」）'),
  }),
  outputSchema: z.object({
    inventory: z.array(
      z.object({
        name: z.string(),
        quantity: z.number(),
        unit: z.string(),
        expiry_date: z.string().nullable(),
      }),
    ),
    recent_meals: z.array(
      z.object({
        date: z.string(),
        meal_type: z.string(),
        dish_name: z.string(),
      }),
    ),
    expiring_soon: z.array(
      z.object({
        name: z.string(),
        quantity: z.number(),
        unit: z.string(),
        expiry_date: z.string(),
        days_remaining: z.number(),
      }),
    ),
    preferences: z.record(z.string(), z.string()),
    additional_request: z.string().nullable(),
  }),
  execute: async ({ meal_type, additional_request }) => {
    // 在庫取得
    const inventoryResult = await db.execute(
      'SELECT name, quantity, unit, expiry_date FROM inventory ORDER BY name',
    );
    const inventory = inventoryResult.rows.map((row) => ({
      name: row.name as string,
      quantity: row.quantity as number,
      unit: row.unit as string,
      expiry_date: (row.expiry_date as string) ?? null,
    }));

    // 直近7日間の食事履歴
    const mealsResult = await db.execute(
      `SELECT date, meal_type, dish_name FROM meals
       WHERE date >= date('now', '-7 days')
       ORDER BY date DESC, created_at DESC`,
    );
    const recent_meals = mealsResult.rows.map((row) => ({
      date: row.date as string,
      meal_type: row.meal_type as string,
      dish_name: row.dish_name as string,
    }));

    // 消費期限が近い食材（3日以内）
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiringResult = await db.execute(
      `SELECT name, quantity, unit, expiry_date FROM inventory
       WHERE expiry_date IS NOT NULL
         AND date(expiry_date) <= date('now', '+3 days')
       ORDER BY expiry_date ASC`,
    );
    const expiring_soon = expiringResult.rows.map((row) => {
      const expiryDate = new Date(row.expiry_date as string);
      expiryDate.setHours(0, 0, 0, 0);
      const diffMs = expiryDate.getTime() - today.getTime();
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return {
        name: row.name as string,
        quantity: row.quantity as number,
        unit: row.unit as string,
        expiry_date: row.expiry_date as string,
        days_remaining: daysRemaining,
      };
    });

    // ユーザー設定
    const prefsResult = await db.execute(
      'SELECT key, value FROM preferences ORDER BY key',
    );
    const preferences: Record<string, string> = {};
    for (const row of prefsResult.rows) {
      preferences[row.key as string] = row.value as string;
    }

    return {
      inventory,
      recent_meals,
      expiring_soon,
      preferences,
      additional_request: additional_request ?? null,
    };
  },
});
