import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '../db/client.js';

export const managePreferencesTool = createTool({
  id: 'manage-preferences',
  description:
    'ユーザー設定を取得・更新します。優先度(priority)、家族構成(household)、アレルギー(allergies)、苦手な食材(dislikes)などを管理します。',
  inputSchema: z.object({
    action: z.enum(['get', 'set']).describe('取得(get)または更新(set)'),
    key: z
      .string()
      .optional()
      .describe(
        '設定キー（priority, household, allergies, dislikes等）。getでkeyなしの場合は全設定を返す',
      ),
    value: z
      .string()
      .optional()
      .describe('設定値（JSON文字列。setで必須）'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    preferences: z.record(z.string(), z.string()),
  }),
  execute: async ({ action, key, value }) => {
    if (action === 'set') {
      if (!key || value === undefined) {
        return {
          success: false,
          message: '設定の更新には key と value が必要です',
          preferences: {},
        };
      }
      const id = `pref-${key}`;
      await db.execute({
        sql: `INSERT INTO preferences (id, key, value, updated_at)
              VALUES (?, ?, ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        args: [id, key, value],
      });
    }

    let result;
    if (key && action === 'get') {
      result = await db.execute({
        sql: 'SELECT key, value FROM preferences WHERE key = ?',
        args: [key],
      });
    } else {
      result = await db.execute(
        'SELECT key, value FROM preferences ORDER BY key',
      );
    }

    const preferences: Record<string, string> = {};
    for (const row of result.rows) {
      preferences[row.key as string] = row.value as string;
    }

    const message =
      action === 'set'
        ? `設定 ${key} を更新しました`
        : '設定を取得しました';

    return { success: true, message, preferences };
  },
});
