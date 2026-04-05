import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '../db/client.js';

export const searchMealsTool = createTool({
  id: 'search-meals',
  description: '食事履歴を検索します。期間やキーワードで絞り込みできます。',
  inputSchema: z.object({
    start_date: z
      .string()
      .optional()
      .describe('検索開始日（YYYY-MM-DD形式）'),
    end_date: z
      .string()
      .optional()
      .describe('検索終了日（YYYY-MM-DD形式）'),
    keyword: z
      .string()
      .optional()
      .describe('料理名で検索するキーワード'),
  }),
  outputSchema: z.object({
    meals: z.array(
      z.object({
        id: z.string(),
        date: z.string(),
        meal_type: z.string(),
        dish_name: z.string(),
        ingredients: z.string(),
        notes: z.string().nullable(),
      }),
    ),
    message: z.string(),
  }),
  execute: async ({ start_date, end_date, keyword }) => {
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    if (start_date) {
      conditions.push('date >= ?');
      args.push(start_date);
    }
    if (end_date) {
      conditions.push('date <= ?');
      args.push(end_date);
    }
    if (keyword) {
      conditions.push('dish_name LIKE ?');
      args.push(`%${keyword}%`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.execute({
      sql: `SELECT * FROM meals ${where} ORDER BY date DESC, created_at DESC`,
      args,
    });

    const meals = result.rows.map((row) => ({
      id: row.id as string,
      date: row.date as string,
      meal_type: row.meal_type as string,
      dish_name: row.dish_name as string,
      ingredients: row.ingredients as string,
      notes: (row.notes as string) ?? null,
    }));

    return {
      meals,
      message:
        meals.length === 0
          ? '該当する食事記録が見つかりませんでした'
          : `${meals.length}件の食事記録が見つかりました`,
    };
  },
});
