import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { suggestMenuTool } from '../suggest-menu.js';
import { manageInventoryTool } from '../manage-inventory.js';
import { recordMealTool } from '../record-meal.js';
import { managePreferencesTool } from '../manage-preferences.js';
import { setupTestDb, cleanupTestDb } from './setup.js';

const execute = suggestMenuTool.execute!;
const addItem = manageInventoryTool.execute!;
const recordMeal = recordMealTool.execute!;
const setPreference = managePreferencesTool.execute!;

describe('suggest-menu', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
  });

  it('在庫・履歴・設定・期限情報をまとめて返す', async () => {
    await addItem({
      action: 'add',
      name: '鶏むね肉',
      quantity: 500,
      unit: 'g',
      expiry_date: '2026-04-08',
    });
    await setPreference({
      action: 'set',
      key: 'priority',
      value: JSON.stringify({ nutrition: 5, ease: 3, cost: 3, variety: 3 }),
    });

    const result = await execute({ meal_type: 'dinner' });

    expect(result.inventory).toHaveLength(1);
    expect(result.inventory[0].name).toBe('鶏むね肉');
    expect(result.preferences).toHaveProperty('priority');
    expect(result.additional_request).toBeNull();
  });

  it('直近7日間の食事履歴を含む', async () => {
    const today = new Date().toISOString().split('T')[0];
    await recordMeal({
      date: today,
      meal_type: 'lunch',
      dish_name: 'カレー',
      ingredients: [],
    });

    const result = await execute({ meal_type: 'dinner' });

    expect(result.recent_meals).toHaveLength(1);
    expect(result.recent_meals[0].dish_name).toBe('カレー');
  });

  it('消費期限が近い食材を返す', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    await addItem({
      action: 'add',
      name: '豆腐',
      quantity: 1,
      unit: 'パック',
      expiry_date: tomorrowStr,
    });

    const result = await execute({ meal_type: 'dinner' });

    expect(result.expiring_soon).toHaveLength(1);
    expect(result.expiring_soon[0].name).toBe('豆腐');
  });

  it('additional_requestを渡せる', async () => {
    const result = await execute({
      meal_type: 'dinner',
      additional_request: '今日は手軽なのがいい',
    });

    expect(result.additional_request).toBe('今日は手軽なのがいい');
  });

  it('空の状態でもエラーなく動作する', async () => {
    const result = await execute({ meal_type: 'breakfast' });

    expect(result.inventory).toHaveLength(0);
    expect(result.recent_meals).toHaveLength(0);
    expect(result.expiring_soon).toHaveLength(0);
    expect(result.preferences).toEqual({});
  });
});
