import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '../db/client.js';
import { parseRecipeRow } from '../utils/dbSchemas.js';

export const searchRecipesTool = createTool({
  id: 'search-recipes',
  description:
    'レシピを検索します。食材名・調理時間・カテゴリ・キーワードで絞り込みできます。',
  inputSchema: z.object({
    keyword: z.string().optional().describe('料理名やサマリーで検索するキーワード'),
    ingredient: z.string().optional().describe('食材名で検索（JSON配列内を部分一致）'),
    category: z
      .string()
      .optional()
      .describe('カテゴリ（主菜, 副菜, 汁物, 主食, デザート, その他）'),
    max_cook_time: z
      .number()
      .optional()
      .describe('最大調理時間（分）'),
  }),
  outputSchema: z.object({
    recipes: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        channel_name: z.string(),
        video_url: z.string(),
        description: z.string(),
        ingredients: z.array(z.string()),
        cook_time_minutes: z.number().nullable(),
        category: z.string().nullable(),
        summary: z.string().nullable(),
      }),
    ),
    message: z.string(),
  }),
  execute: async ({ keyword, ingredient, category, max_cook_time }) => {
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    if (keyword) {
      conditions.push('(title LIKE ? OR summary LIKE ?)');
      args.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (ingredient) {
      conditions.push('ingredients LIKE ?');
      args.push(`%${ingredient}%`);
    }
    if (category) {
      conditions.push('category = ?');
      args.push(category);
    }
    if (max_cook_time !== undefined) {
      conditions.push('cook_time_minutes IS NOT NULL AND cook_time_minutes <= ?');
      args.push(max_cook_time);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.execute({
      sql: `SELECT * FROM recipes ${where} ORDER BY title ASC LIMIT 20`,
      args,
    });

    const recipes = result.rows.map((row) => {
      const parsed = parseRecipeRow(row as Record<string, unknown>);
      let ingredientsList: string[] = [];
      try {
        ingredientsList = JSON.parse(parsed.ingredients);
      } catch {
        ingredientsList = [];
      }
      return {
        id: parsed.id,
        title: parsed.title,
        channel_name: parsed.channel_name,
        video_url: parsed.video_url,
        description: parsed.description,
        ingredients: ingredientsList,
        cook_time_minutes: parsed.cook_time_minutes,
        category: parsed.category,
        summary: parsed.summary,
      };
    });

    return {
      recipes,
      message:
        recipes.length === 0
          ? '該当するレシピが見つかりませんでした'
          : `${recipes.length}件のレシピが見つかりました`,
    };
  },
});
