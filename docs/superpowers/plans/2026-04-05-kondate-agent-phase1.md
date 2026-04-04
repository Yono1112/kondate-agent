# 献立エージェント Phase 1 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 毎日会話しながら献立提案・食材在庫管理・食事記録ができるエージェントを構築する

**Architecture:** シンプルエージェント1つ（Gemini 3 Flash）+ 6つのツール + LibSQLカスタムテーブル3つ。ツールは `@libsql/client` で直接DBを操作し、エージェントがそれらを組み合わせて献立を提案する。

**Tech Stack:** Mastra (`@mastra/core` v1.21+), `@mastra/memory`, `@mastra/libsql`, `@libsql/client`, Zod v4, TypeScript ES2022

**Spec:** `docs/superpowers/specs/2026-04-05-kondate-agent-phase1-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/mastra/db/client.ts` | LibSQLクライアントの初期化（シングルトン） |
| `src/mastra/db/schema.ts` | テーブル作成（inventory, meals, preferences） |
| `src/mastra/db/seed.ts` | 初期データ投入（デフォルトpreferences） |
| `src/mastra/tools/manage-inventory.ts` | 食材在庫の追加・更新・削除・一覧 |
| `src/mastra/tools/check-expiry.ts` | 消費期限チェック |
| `src/mastra/tools/record-meal.ts` | 食事記録 |
| `src/mastra/tools/search-meals.ts` | 食事履歴検索 |
| `src/mastra/tools/manage-preferences.ts` | ユーザー設定の取得・更新 |
| `src/mastra/tools/suggest-menu.ts` | 献立コンテキスト取得 |
| `src/mastra/agents/kondate-agent.ts` | 自炊アシスタントエージェント定義 |
| `src/mastra/index.ts` | Mastraインスタンス（エージェント・ツール登録） |

---

## Task 1: 既存のweather関連ファイルを削除

**Files:**
- Delete: `src/mastra/agents/weather-agent.ts`
- Delete: `src/mastra/tools/weather-tool.ts`
- Delete: `src/mastra/workflows/weather-workflow.ts`
- Delete: `src/mastra/scorers/weather-scorer.ts`

- [ ] **Step 1: weather関連ファイルを削除**

```bash
rm src/mastra/agents/weather-agent.ts
rm src/mastra/tools/weather-tool.ts
rm src/mastra/workflows/weather-workflow.ts
rm src/mastra/scorers/weather-scorer.ts
```

- [ ] **Step 2: index.tsを最小構成に書き換え**

`src/mastra/index.ts` を以下に置き換える:

```typescript
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';

export const mastra = new Mastra({
  agents: {},
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: 'file:./mastra.db',
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
```

- [ ] **Step 3: ビルド確認**

Run: `npm run build`
Expected: 成功（エラーなし）

- [ ] **Step 4: コミット**

```bash
git add -A
git commit -m "chore: weather関連ファイルを削除し、最小構成にリセット"
```

---

## Task 2: DBクライアントとスキーマ作成

**Files:**
- Create: `src/mastra/db/client.ts`
- Create: `src/mastra/db/schema.ts`
- Create: `src/mastra/db/seed.ts`

- [ ] **Step 1: DBクライアントを作成**

`src/mastra/db/client.ts`:

```typescript
import { createClient } from '@libsql/client';

export const db = createClient({
  url: 'file:./kondate.db',
});
```

- [ ] **Step 2: スキーマ作成関数を作成**

`src/mastra/db/schema.ts`:

```typescript
import { db } from './client.js';

export async function initializeDatabase(): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      expiry_date TEXT,
      purchased_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
      dish_name TEXT NOT NULL,
      ingredients TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS preferences (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
```

- [ ] **Step 3: シードデータ作成**

`src/mastra/db/seed.ts`:

```typescript
import { db } from './client.js';
import { initializeDatabase } from './schema.js';

const defaultPreferences = [
  {
    id: 'pref-priority',
    key: 'priority',
    value: JSON.stringify({ nutrition: 3, ease: 3, cost: 3, variety: 3 }),
  },
  {
    id: 'pref-household',
    key: 'household',
    value: JSON.stringify({ adults: 1, children: 0 }),
  },
  {
    id: 'pref-allergies',
    key: 'allergies',
    value: JSON.stringify([]),
  },
  {
    id: 'pref-dislikes',
    key: 'dislikes',
    value: JSON.stringify([]),
  },
];

export async function seedDatabase(): Promise<void> {
  await initializeDatabase();

  for (const pref of defaultPreferences) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO preferences (id, key, value) VALUES (?, ?, ?)`,
      args: [pref.id, pref.key, pref.value],
    });
  }
}
```

- [ ] **Step 4: DB初期化が動くことを確認**

ファイル末尾に一時的なスクリプトを実行して確認:

```bash
npx tsx -e "import { seedDatabase } from './src/mastra/db/seed.js'; await seedDatabase(); console.log('DB initialized successfully');"
```

Expected: `DB initialized successfully`

- [ ] **Step 5: ビルド確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 6: コミット**

```bash
git add src/mastra/db/
git commit -m "feat: LibSQLクライアント・スキーマ・シードデータを追加"
```

---

## Task 3: manage_inventoryツール

**Files:**
- Create: `src/mastra/tools/manage-inventory.ts`

- [ ] **Step 1: manage-inventory.tsを作成**

`src/mastra/tools/manage-inventory.ts`:

```typescript
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
```

- [ ] **Step 2: ビルド確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: コミット**

```bash
git add src/mastra/tools/manage-inventory.ts
git commit -m "feat: manage_inventoryツールを実装"
```

---

## Task 4: check_expiryツール

**Files:**
- Create: `src/mastra/tools/check-expiry.ts`

- [ ] **Step 1: check-expiry.tsを作成**

`src/mastra/tools/check-expiry.ts`:

```typescript
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
```

- [ ] **Step 2: ビルド確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: コミット**

```bash
git add src/mastra/tools/check-expiry.ts
git commit -m "feat: check_expiryツールを実装"
```

---

## Task 5: record_mealツール

**Files:**
- Create: `src/mastra/tools/record-meal.ts`

- [ ] **Step 1: record-meal.tsを作成**

`src/mastra/tools/record-meal.ts`:

```typescript
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
    const id = `meal-${Date.now()}`;

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
```

- [ ] **Step 2: ビルド確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: コミット**

```bash
git add src/mastra/tools/record-meal.ts
git commit -m "feat: record_mealツールを実装（在庫自動減算あり）"
```

---

## Task 6: search_mealsツール

**Files:**
- Create: `src/mastra/tools/search-meals.ts`

- [ ] **Step 1: search-meals.tsを作成**

`src/mastra/tools/search-meals.ts`:

```typescript
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
```

- [ ] **Step 2: ビルド確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: コミット**

```bash
git add src/mastra/tools/search-meals.ts
git commit -m "feat: search_mealsツールを実装"
```

---

## Task 7: manage_preferencesツール

**Files:**
- Create: `src/mastra/tools/manage-preferences.ts`

- [ ] **Step 1: manage-preferences.tsを作成**

`src/mastra/tools/manage-preferences.ts`:

```typescript
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
```

- [ ] **Step 2: ビルド確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: コミット**

```bash
git add src/mastra/tools/manage-preferences.ts
git commit -m "feat: manage_preferencesツールを実装"
```

---

## Task 8: suggest_menuツール

**Files:**
- Create: `src/mastra/tools/suggest-menu.ts`

- [ ] **Step 1: suggest-menu.tsを作成**

`src/mastra/tools/suggest-menu.ts`:

```typescript
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
```

- [ ] **Step 2: ビルド確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: コミット**

```bash
git add src/mastra/tools/suggest-menu.ts
git commit -m "feat: suggest_menuツールを実装"
```

---

## Task 9: 自炊アシスタントエージェント定義

**Files:**
- Create: `src/mastra/agents/kondate-agent.ts`

- [ ] **Step 1: kondate-agent.tsを作成**

`src/mastra/agents/kondate-agent.ts`:

```typescript
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { manageInventoryTool } from '../tools/manage-inventory.js';
import { checkExpiryTool } from '../tools/check-expiry.js';
import { recordMealTool } from '../tools/record-meal.js';
import { searchMealsTool } from '../tools/search-meals.js';
import { managePreferencesTool } from '../tools/manage-preferences.js';
import { suggestMenuTool } from '../tools/suggest-menu.js';

export const kondateAgent = new Agent({
  id: 'kondate-agent',
  name: '自炊アシスタント',
  instructions: `あなたは自炊アシスタントです。毎日の献立提案・食材在庫管理・食事記録をサポートします。

## 基本方針
- 日本語で応答してください
- 簡潔でフレンドリーな口調で話してください
- ユーザーの設定（優先度・家族構成・好み・アレルギー）を manage-preferences ツールで確認して考慮してください

## 献立提案の手順
1. まず suggest-menu ツールで在庫・履歴・設定を確認する
2. その情報をもとに3つ程度の献立候補を考える
3. 各候補について以下を提示する:
   - 料理名
   - 必要食材
   - 在庫でまかなえる食材と買い足しが必要な食材
4. ユーザーが選んだら、食事記録を促す

## 献立の考え方
- ユーザー設定の優先度（栄養バランス/手軽さ/コスト/バリエーション）に従う
- 直近7日間の食事と被らないようにする
- 在庫の食材を優先的に使う（特に消費期限が近いもの）
- アレルギーや苦手な食材は絶対に含めない

## 設定の一時的な上書き
- 「今日は手軽なのがいい」のような一時的な要望は、設定を更新せずその会話内でのみ反映する
- 「いつも安く済ませたい」のような恒久的な変更の場合のみ manage-preferences で設定を更新する

## 食材管理
- ユーザーが食材を買ったと言ったら manage-inventory で在庫に追加する
- 食事を記録する際は record-meal を使い、在庫が自動的に減る
- 消費期限が近い食材がある場合は積極的に使うメニューを提案する`,
  model: 'google/gemini-3-flash-preview',
  tools: {
    manageInventoryTool,
    checkExpiryTool,
    recordMealTool,
    searchMealsTool,
    managePreferencesTool,
    suggestMenuTool,
  },
  memory: new Memory(),
});
```

- [ ] **Step 2: ビルド確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: コミット**

```bash
git add src/mastra/agents/kondate-agent.ts
git commit -m "feat: 自炊アシスタントエージェントを定義"
```

---

## Task 10: Mastraインスタンスにエージェント・DB初期化を統合

**Files:**
- Modify: `src/mastra/index.ts`

- [ ] **Step 1: index.tsを更新**

`src/mastra/index.ts` を以下に書き換える:

```typescript
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { kondateAgent } from './agents/kondate-agent.js';
import { seedDatabase } from './db/seed.js';

// DB初期化（テーブル作成・デフォルトデータ投入）
await seedDatabase();

export const mastra = new Mastra({
  agents: { kondateAgent },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: 'file:./mastra.db',
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
```

- [ ] **Step 2: ビルド確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: コミット**

```bash
git add src/mastra/index.ts
git commit -m "feat: MastraインスタンスにエージェントとDB初期化を統合"
```

---

## Task 11: Mastra Studioで動作確認

- [ ] **Step 1: Mastra Studioを起動**

```bash
npm run dev
```

ブラウザで http://localhost:4111 を開く。
Expected: 「自炊アシスタント」エージェントが表示される

- [ ] **Step 2: 基本的な会話テスト**

Studioのチャットで以下を試す:

1. 「こんにちは」→ フレンドリーな挨拶が返る
2. 「鶏むね肉500g、消費期限は2026-04-08で在庫に追加して」→ manage-inventoryツールが呼ばれて在庫に追加される
3. 「在庫を見せて」→ 追加した鶏むね肉が表示される
4. 「今日の夕飯を提案して」→ suggest-menuが呼ばれ、3つ程度の候補が返る
5. 「1番目のメニューにする。記録して」→ record-mealが呼ばれて記録される
6. 「優先度をコスト重視に変更して」→ manage-preferencesが呼ばれて設定が更新される

- [ ] **Step 3: 問題があれば修正してコミット**

```bash
git add -A
git commit -m "fix: Mastra Studio動作確認で見つかった問題を修正"
```

※ 問題がなければこのステップはスキップ

- [ ] **Step 4: 最終コミット**

```bash
git add -A
git commit -m "feat: Phase 1完了 — 献立提案・食材管理・食事記録エージェント"
```
