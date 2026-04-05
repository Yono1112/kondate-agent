import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { managePreferencesTool } from '../manage-preferences.js';
import { setupTestDb, cleanupTestDb } from './setup.js';

const execute = managePreferencesTool.execute!;

describe('manage-preferences', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
  });

  it('set: 設定を保存できる', async () => {
    const result = await execute({
      action: 'set',
      key: 'allergies',
      value: JSON.stringify(['えび', 'かに']),
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('allergies');
  });

  it('get: 特定の設定を取得できる', async () => {
    await execute({
      action: 'set',
      key: 'priority',
      value: JSON.stringify({ nutrition: 5, ease: 3, cost: 4, variety: 3 }),
    });

    const result = await execute({ action: 'get', key: 'priority' });

    expect(result.success).toBe(true);
    expect(result.preferences).toHaveProperty('priority');
    const priority = JSON.parse(result.preferences.priority);
    expect(priority.nutrition).toBe(5);
  });

  it('get: keyなしで全設定を返す', async () => {
    await execute({
      action: 'set',
      key: 'allergies',
      value: JSON.stringify([]),
    });
    await execute({
      action: 'set',
      key: 'dislikes',
      value: JSON.stringify(['パクチー']),
    });

    const result = await execute({ action: 'get' });

    expect(result.success).toBe(true);
    expect(Object.keys(result.preferences).length).toBe(2);
  });

  it('set: 既存の設定を上書きできる', async () => {
    await execute({
      action: 'set',
      key: 'household',
      value: JSON.stringify({ adults: 1, children: 0 }),
    });
    await execute({
      action: 'set',
      key: 'household',
      value: JSON.stringify({ adults: 2, children: 1 }),
    });

    const result = await execute({ action: 'get', key: 'household' });
    const household = JSON.parse(result.preferences.household);
    expect(household.adults).toBe(2);
    expect(household.children).toBe(1);
  });

  it('set: keyまたはvalueがない場合エラーを返す', async () => {
    const result = await execute({ action: 'set', key: 'test' });

    expect(result.success).toBe(false);
  });
});
