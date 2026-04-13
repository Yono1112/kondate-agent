import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { searchRecipesTool } from '../search-recipes.js';
import { setupTestDb, cleanupTestDb } from './setup.js';
import { db } from '../../db/client.js';

const execute = searchRecipesTool.execute!;

async function insertRecipe(overrides: Partial<{
  id: string;
  title: string;
  channel_name: string;
  channel_id: string;
  video_id: string;
  video_url: string;
  description: string;
  ingredients: string;
  cook_time_minutes: number | null;
  category: string | null;
  summary: string | null;
}> = {}) {
  const defaults = {
    id: `recipe-${crypto.randomUUID()}`,
    title: 'テスト料理',
    channel_name: 'テストチャンネル',
    channel_id: 'UC_test',
    video_id: `vid-${crypto.randomUUID()}`,
    video_url: 'https://youtube.com/watch?v=test',
    description: '材料: 鶏むね肉, 醤油, みりん\n作り方: ...',
    ingredients: JSON.stringify(['鶏むね肉', '醤油', 'みりん']),
    cook_time_minutes: 30,
    category: '主菜',
    summary: '簡単な鶏むね肉料理',
  };
  const r = { ...defaults, ...overrides };
  await db.execute({
    sql: `INSERT INTO recipes (id, title, channel_name, channel_id, video_id, video_url, description, ingredients, cook_time_minutes, category, summary)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [r.id, r.title, r.channel_name, r.channel_id, r.video_id, r.video_url, r.description, r.ingredients, r.cook_time_minutes, r.category, r.summary],
  });
}

describe('search-recipes', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
  });

  it('キーワードでレシピを検索できる', async () => {
    await insertRecipe({ title: '鶏むね肉の照り焼き' });
    await insertRecipe({ title: 'サバの味噌煮' });

    const result = await execute({ keyword: '照り焼き' });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].title).toBe('鶏むね肉の照り焼き');
  });

  it('食材で検索できる', async () => {
    await insertRecipe({
      title: '鶏むね肉ソテー',
      ingredients: JSON.stringify(['鶏むね肉', '塩', 'こしょう']),
    });
    await insertRecipe({
      title: '豚しょうが焼き',
      ingredients: JSON.stringify(['豚ロース', 'しょうが', '醤油']),
    });

    const result = await execute({ ingredient: '鶏むね肉' });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].title).toBe('鶏むね肉ソテー');
  });

  it('カテゴリで絞り込みできる', async () => {
    await insertRecipe({ title: '味噌汁', category: '汁物' });
    await insertRecipe({ title: 'ステーキ', category: '主菜' });

    const result = await execute({ category: '汁物' });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].title).toBe('味噌汁');
  });

  it('調理時間で絞り込みできる', async () => {
    await insertRecipe({ title: '簡単サラダ', cook_time_minutes: 10 });
    await insertRecipe({ title: '煮込みカレー', cook_time_minutes: 60 });

    const result = await execute({ max_cook_time: 30 });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].title).toBe('簡単サラダ');
  });

  it('該当なしの場合メッセージを返す', async () => {
    const result = await execute({ keyword: '存在しないレシピ' });

    expect(result.recipes).toHaveLength(0);
    expect(result.message).toContain('見つかりませんでした');
  });

  it('条件なしで全レシピを返す', async () => {
    await insertRecipe({ title: 'レシピA' });
    await insertRecipe({ title: 'レシピB' });

    const result = await execute({});

    expect(result.recipes).toHaveLength(2);
  });
});
