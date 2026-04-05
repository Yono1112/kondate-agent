import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { checkExpiryTool } from '../check-expiry.js';
import { manageInventoryTool } from '../manage-inventory.js';
import { setupTestDb, cleanupTestDb } from './setup.js';

const execute = checkExpiryTool.execute!;
const addItem = manageInventoryTool.execute!;

describe('check-expiry', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
  });

  it('期限が近い食材を返す', async () => {
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

    const result = await execute({ threshold_days: 3 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('豆腐');
    expect(result.items[0].days_remaining).toBeLessThanOrEqual(3);
  });

  it('期限が遠い食材は返さない', async () => {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 30);
    const farFutureStr = farFuture.toISOString().split('T')[0];

    await addItem({
      action: 'add',
      name: '缶詰',
      quantity: 1,
      unit: '個',
      expiry_date: farFutureStr,
    });

    const result = await execute({ threshold_days: 3 });

    expect(result.items).toHaveLength(0);
    expect(result.message).toContain('ありません');
  });

  it('消費期限なしの食材は返さない', async () => {
    await addItem({
      action: 'add',
      name: '塩',
      quantity: 1,
      unit: '袋',
    });

    const result = await execute({ threshold_days: 3 });

    expect(result.items).toHaveLength(0);
  });
});
