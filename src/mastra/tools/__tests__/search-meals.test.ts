import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { searchMealsTool } from '../search-meals.js';
import { recordMealTool } from '../record-meal.js';
import { setupTestDb, cleanupTestDb } from './setup.js';

const execute = searchMealsTool.execute!;
const recordMeal = recordMealTool.execute!;

describe('search-meals', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
  });

  it('全履歴を取得できる', async () => {
    await recordMeal({
      date: '2026-04-05',
      meal_type: 'dinner',
      dish_name: 'カレー',
      ingredients: [],
    });
    await recordMeal({
      date: '2026-04-06',
      meal_type: 'lunch',
      dish_name: 'パスタ',
      ingredients: [],
    });

    const result = await execute({});

    expect(result.meals).toHaveLength(2);
    expect(result.message).toContain('2件');
  });

  it('期間で絞り込みできる', async () => {
    await recordMeal({
      date: '2026-04-01',
      meal_type: 'dinner',
      dish_name: 'カレー',
      ingredients: [],
    });
    await recordMeal({
      date: '2026-04-06',
      meal_type: 'dinner',
      dish_name: 'パスタ',
      ingredients: [],
    });

    const result = await execute({
      start_date: '2026-04-05',
      end_date: '2026-04-06',
    });

    expect(result.meals).toHaveLength(1);
    expect(result.meals[0].dish_name).toBe('パスタ');
  });

  it('キーワードで検索できる', async () => {
    await recordMeal({
      date: '2026-04-06',
      meal_type: 'dinner',
      dish_name: '鶏むね肉の照り焼き',
      ingredients: [],
    });
    await recordMeal({
      date: '2026-04-06',
      meal_type: 'lunch',
      dish_name: 'サラダ',
      ingredients: [],
    });

    const result = await execute({ keyword: '照り焼き' });

    expect(result.meals).toHaveLength(1);
    expect(result.meals[0].dish_name).toContain('照り焼き');
  });

  it('該当なしの場合メッセージを返す', async () => {
    const result = await execute({ keyword: '存在しない料理' });

    expect(result.meals).toHaveLength(0);
    expect(result.message).toContain('見つかりませんでした');
  });
});
