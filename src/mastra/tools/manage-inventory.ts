import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '../db/client.js';

export const manageInventoryTool = createTool({
  id: 'manage-inventory',
  description:
    '食材在庫を管理します。食材の追加(add)・更新(update)・削除(remove)・一覧取得(list)ができます。',
  inputSchema: z.object({
    action: z
      .enum(['add', 'update', 'remove', 'list'])
      .describe('実行するアクション'),
    name: z.string().optional().describe('食材名（add/update/removeで必須）'),
    quantity: z.number().optional().describe('数量（add/updateで使用）'),
    unit: z
      .string()
      .optional()
      .describe('単位（個, g, ml, 本, パック等。addで使用）'),
    expiry_date: z
      .string()
      .optional()
      .describe('消費期限（YYYY-MM-DD形式。add/updateで使用）'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    inventory: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        quantity: z.number(),
        unit: z.string(),
        expiry_date: z.string().nullable(),
        purchased_at: z.string().nullable(),
      }),
    ),
  }),
  execute: async ({ action, name, quantity, unit, expiry_date }) => {
    if (action === 'add') {
      if (!name || quantity === undefined || !unit) {
        return {
          success: false,
          message: '食材の追加には name, quantity, unit が必要です',
          inventory: [],
        };
      }
      const id = `inv-${Date.now()}`;
      const today = new Date().toISOString().split('T')[0];
      await db.execute({
        sql: `INSERT INTO inventory (id, name, quantity, unit, expiry_date, purchased_at) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [id, name, quantity, unit, expiry_date ?? null, today],
      });
    }

    if (action === 'update') {
      if (!name) {
        return {
          success: false,
          message: '更新には name が必要です',
          inventory: [],
        };
      }
      const sets: string[] = [];
      const args: (string | number | null)[] = [];
      if (quantity !== undefined) {
        sets.push('quantity = ?');
        args.push(quantity);
      }
      if (expiry_date !== undefined) {
        sets.push('expiry_date = ?');
        args.push(expiry_date);
      }
      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        args.push(name);
        await db.execute({
          sql: `UPDATE inventory SET ${sets.join(', ')} WHERE name = ?`,
          args,
        });
      }
    }

    if (action === 'remove') {
      if (!name) {
        return {
          success: false,
          message: '削除には name が必要です',
          inventory: [],
        };
      }
      await db.execute({
        sql: `DELETE FROM inventory WHERE name = ?`,
        args: [name],
      });
    }

    const result = await db.execute('SELECT * FROM inventory ORDER BY name');
    const inventory = result.rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      quantity: row.quantity as number,
      unit: row.unit as string,
      expiry_date: (row.expiry_date as string) ?? null,
      purchased_at: (row.purchased_at as string) ?? null,
    }));

    const messages: Record<string, string> = {
      add: `${name} を在庫に追加しました`,
      update: `${name} の情報を更新しました`,
      remove: `${name} を在庫から削除しました`,
      list: '在庫一覧を取得しました',
    };

    return {
      success: true,
      message: messages[action],
      inventory,
    };
  },
});
