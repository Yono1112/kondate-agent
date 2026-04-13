import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '../db/client.js';
import { parseInventoryRow, parseMealRow } from '../utils/dbSchemas.js';
import { calculateDaysRemaining } from '../utils/dateUtils.js';
import { rowsToPreferenceMap } from '../utils/preferences.js';

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
      'SELECT * FROM inventory ORDER BY name',
    );
    const inventory = inventoryResult.rows.map((row) => {
      const parsed = parseInventoryRow(row as Record<string, unknown>);
      return { name: parsed.name, quantity: parsed.quantity, unit: parsed.unit, expiry_date: parsed.expiry_date };
    });

    // 直近7日間の食事履歴
    const mealsResult = await db.execute(
      `SELECT * FROM meals
       WHERE date >= date('now', '-7 days')
       ORDER BY date DESC, created_at DESC`,
    );
    const recent_meals = mealsResult.rows.map((row) => {
      const parsed = parseMealRow(row as Record<string, unknown>);
      return { date: parsed.date, meal_type: parsed.meal_type, dish_name: parsed.dish_name };
    });

    // 消費期限が近い食材（3日以内）
    const expiringResult = await db.execute(
      `SELECT * FROM inventory
       WHERE expiry_date IS NOT NULL
         AND date(expiry_date) <= date('now', '+3 days')
       ORDER BY expiry_date ASC`,
    );
    const expiring_soon = expiringResult.rows.map((row) => {
      const parsed = parseInventoryRow(row as Record<string, unknown>);
      return {
        name: parsed.name,
        quantity: parsed.quantity,
        unit: parsed.unit,
        expiry_date: parsed.expiry_date ?? '',
        days_remaining: calculateDaysRemaining(parsed.expiry_date ?? ''),
      };
    });

    // ユーザー設定
    const prefsResult = await db.execute(
      'SELECT key, value FROM preferences ORDER BY key',
    );
    const preferences = rowsToPreferenceMap(
      prefsResult.rows as Record<string, unknown>[],
    );

    return {
      inventory,
      recent_meals,
      expiring_soon,
      preferences,
      additional_request: additional_request ?? null,
    };
  },
});
