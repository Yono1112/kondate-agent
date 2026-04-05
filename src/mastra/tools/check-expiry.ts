import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '../db/client.js';

export const checkExpiryTool = createTool({
  id: 'check-expiry',
  description:
    '消費期限が近い食材を確認します。デフォルトで3日以内に期限が切れる食材を返します。',
  inputSchema: z.object({
    threshold_days: z
      .number()
      .optional()
      .default(3)
      .describe('何日以内の食材を警告するか（デフォルト3日）'),
  }),
  outputSchema: z.object({
    items: z.array(
      z.object({
        name: z.string(),
        quantity: z.number(),
        unit: z.string(),
        expiry_date: z.string(),
        days_remaining: z.number(),
      }),
    ),
    message: z.string(),
  }),
  execute: async ({ threshold_days }) => {
    const days = threshold_days ?? 3;
    const result = await db.execute({
      sql: `SELECT * FROM inventory
            WHERE expiry_date IS NOT NULL
              AND date(expiry_date) <= date('now', '+' || ? || ' days')
            ORDER BY expiry_date ASC`,
      args: [days],
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items = result.rows.map((row) => {
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

    const message =
      items.length === 0
        ? `${days}日以内に期限が切れる食材はありません`
        : `${items.length}件の食材が${days}日以内に期限を迎えます`;

    return { items, message };
  },
});
