import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { recordMealTool } from '../record-meal.js';
import { manageInventoryTool } from '../manage-inventory.js';
import { setupTestDb, cleanupTestDb } from './setup.js';

const execute = recordMealTool.execute!;
const addItem = manageInventoryTool.execute!;

describe('record-meal', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
  });

  it('食事を記録できる', async () => {
    const result = await execute({
      date: '2026-04-06',
      meal_type: 'dinner',
      dish_name: '鶏むね肉の照り焼き',
      ingredients: [{ name: '鶏むね肉', quantity: 200, unit: 'g' }],
    });

    expect(result.success).toBe(true);
    expect(result.meal_id).toMatch(/^meal-/);
    expect(result.message).toContain('鶏むね肉の照り焼き');
  });

  it('記録時に在庫が自動で減る', async () => {
    await addItem({
      action: 'add',
      name: '鶏むね肉',
      quantity: 500,
      unit: 'g',
    });

    await execute({
      date: '2026-04-06',
      meal_type: 'dinner',
      dish_name: '照り焼き',
      ingredients: [{ name: '鶏むね肉', quantity: 200, unit: 'g' }],
    });

    const inventory = await addItem({ action: 'list' });
    expect(inventory.inventory[0].quantity).toBe(300);
  });

  it('在庫が0になったら自動で削除される', async () => {
    await addItem({
      action: 'add',
      name: '豆腐',
      quantity: 1,
      unit: 'パック',
    });

    await execute({
      date: '2026-04-06',
      meal_type: 'lunch',
      dish_name: '冷奴',
      ingredients: [{ name: '豆腐', quantity: 1, unit: 'パック' }],
    });

    const inventory = await addItem({ action: 'list' });
    expect(inventory.inventory).toHaveLength(0);
  });

  it('notesを含めて記録できる', async () => {
    const result = await execute({
      date: '2026-04-06',
      meal_type: 'breakfast',
      dish_name: 'トースト',
      ingredients: [{ name: '食パン', quantity: 2, unit: '枚' }],
      notes: '美味しかった',
    });

    expect(result.success).toBe(true);
  });
});
