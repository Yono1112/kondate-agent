import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { manageInventoryTool } from '../manage-inventory.js';
import { setupTestDb, cleanupTestDb } from './setup.js';

const execute = manageInventoryTool.execute!;

describe('manage-inventory', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
  });

  it('add: 食材を追加できる', async () => {
    const result = await execute({
      action: 'add',
      name: '鶏むね肉',
      quantity: 500,
      unit: 'g',
      expiry_date: '2026-04-10',
    });

    expect(result.success).toBe(true);
    expect(result.inventory).toHaveLength(1);
    expect(result.inventory[0].name).toBe('鶏むね肉');
    expect(result.inventory[0].quantity).toBe(500);
    expect(result.inventory[0].unit).toBe('g');
    expect(result.inventory[0].expiry_date).toBe('2026-04-10');
  });

  it('add: 必須パラメータが不足している場合エラーを返す', async () => {
    const result = await execute({
      action: 'add',
      name: '卵',
    });

    expect(result.success).toBe(false);
    expect(result.inventory).toHaveLength(0);
  });

  it('list: 全在庫を名前順で返す', async () => {
    await execute({ action: 'add', name: 'トマト', quantity: 3, unit: '個' });
    await execute({ action: 'add', name: 'きゅうり', quantity: 2, unit: '本' });

    const result = await execute({ action: 'list' });

    expect(result.success).toBe(true);
    expect(result.inventory).toHaveLength(2);
    expect(result.inventory[0].name).toBe('きゅうり');
    expect(result.inventory[1].name).toBe('トマト');
  });

  it('update: 数量を更新できる', async () => {
    await execute({ action: 'add', name: '卵', quantity: 10, unit: '個' });

    const result = await execute({
      action: 'update',
      name: '卵',
      quantity: 6,
    });

    expect(result.success).toBe(true);
    expect(result.inventory[0].quantity).toBe(6);
  });

  it('update: nameがない場合エラーを返す', async () => {
    const result = await execute({ action: 'update' });

    expect(result.success).toBe(false);
  });

  it('remove: 食材を削除できる', async () => {
    await execute({ action: 'add', name: '牛乳', quantity: 1, unit: 'パック' });

    const result = await execute({ action: 'remove', name: '牛乳' });

    expect(result.success).toBe(true);
    expect(result.inventory).toHaveLength(0);
  });

  it('remove: nameがない場合エラーを返す', async () => {
    const result = await execute({ action: 'remove' });

    expect(result.success).toBe(false);
  });
});
