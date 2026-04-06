import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { parseReceiptTool } from '../parse-receipt.js';
import { manageInventoryTool } from '../manage-inventory.js';
import { setupTestDb, cleanupTestDb } from './setup.js';
import { db } from '../../db/client.js';

const { mockGenerateObject } = vi.hoisted(() => ({
  mockGenerateObject: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: mockGenerateObject,
}));

vi.mock('@ai-sdk/google', () => ({
  google: vi.fn(() => 'mocked-model'),
}));

const execute = parseReceiptTool.execute!;
const addItem = manageInventoryTool.execute!;

// 正常な画像レスポンスを返すグローバルfetchモックを設定
function mockImageFetch() {
  const fakeImage = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => fakeImage,
      headers: { get: () => 'image/jpeg' },
    }),
  );
}

// Geminiのレシート解析結果をモック
function mockReceiptResult(overrides?: {
  store_name?: string | null;
  items?: Array<{
    item_name: string;
    price: number | null;
    quantity: number;
    unit: string;
    is_food: boolean;
  }>;
}) {
  mockGenerateObject.mockResolvedValue({
    object: {
      store_name: overrides?.store_name ?? 'テストスーパー',
      items: overrides?.items ?? [
        { item_name: '鶏むね肉', price: 198, quantity: 300, unit: 'g', is_food: true },
        { item_name: 'トマト', price: 88, quantity: 2, unit: '個', is_food: true },
      ],
    },
  });
}

describe('parse-receipt', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
    vi.clearAllMocks();
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('画像取得が失敗した場合エラーを返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, statusText: 'Not Found' }),
    );

    const result = await execute({ image_url: 'https://example.com/receipt.jpg' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('取得に失敗');
    expect(result.inventory_updated).toBe(0);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('レシートから食材を抽出して在庫に追加できる', async () => {
    mockImageFetch();
    mockReceiptResult();

    const result = await execute({ image_url: 'https://example.com/receipt.jpg' });

    expect(result.success).toBe(true);
    expect(result.inventory_updated).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].item_name).toBe('鶏むね肉');
    expect(result.items[1].item_name).toBe('トマト');

    const inv = await db.execute('SELECT * FROM inventory ORDER BY name');
    expect(inv.rows).toHaveLength(2);
    expect(inv.rows.map((r) => r.name)).toContain('鶏むね肉');
    expect(inv.rows.map((r) => r.name)).toContain('トマト');
  });

  it('is_food=falseのアイテムは在庫に追加されない', async () => {
    mockImageFetch();
    mockReceiptResult({
      items: [
        { item_name: '鶏むね肉', price: 198, quantity: 300, unit: 'g', is_food: true },
        { item_name: 'レジ袋', price: 3, quantity: 1, unit: '枚', is_food: false },
        { item_name: 'ポイント割引', price: -10, quantity: 1, unit: '円', is_food: false },
      ],
    });

    const result = await execute({ image_url: 'https://example.com/receipt.jpg' });

    expect(result.success).toBe(true);
    expect(result.inventory_updated).toBe(1);
    expect(result.items).toHaveLength(1);

    const inv = await db.execute('SELECT * FROM inventory');
    expect(inv.rows).toHaveLength(1);
    expect(inv.rows[0].name).toBe('鶏むね肉');
  });

  it('同名食材が既に在庫にある場合は数量を加算する', async () => {
    await addItem({ action: 'add', name: '鶏むね肉', quantity: 200, unit: 'g' });

    mockImageFetch();
    mockReceiptResult({
      items: [
        { item_name: '鶏むね肉', price: 198, quantity: 300, unit: 'g', is_food: true },
      ],
    });

    const result = await execute({ image_url: 'https://example.com/receipt.jpg' });

    expect(result.success).toBe(true);
    expect(result.inventory_updated).toBe(1);

    const inv = await db.execute("SELECT * FROM inventory WHERE name = '鶏むね肉'");
    expect(inv.rows).toHaveLength(1);
    expect(inv.rows[0].quantity).toBe(500); // 200 + 300
  });

  it('購入履歴（purchases）にレシートの食材が記録される', async () => {
    mockImageFetch();
    mockReceiptResult({
      store_name: 'マルエツ',
      items: [
        { item_name: '豆腐', price: 68, quantity: 1, unit: 'パック', is_food: true },
      ],
    });

    await execute({
      image_url: 'https://example.com/receipt.jpg',
      purchased_at: '2026-04-05',
    });

    const purchases = await db.execute('SELECT * FROM purchases');
    expect(purchases.rows).toHaveLength(1);
    expect(purchases.rows[0].item_name).toBe('豆腐');
    expect(purchases.rows[0].price).toBe(68);
    expect(purchases.rows[0].purchased_at).toBe('2026-04-05');
    expect(purchases.rows[0].receipt_image_url).toBe('https://example.com/receipt.jpg');
  });

  it('store_name未指定時はGeminiの解析結果を店舗名として使用する', async () => {
    mockImageFetch();
    mockReceiptResult({
      store_name: 'イオン渋谷店',
      items: [
        { item_name: '牛乳', price: 198, quantity: 1, unit: 'パック', is_food: true },
      ],
    });

    await execute({ image_url: 'https://example.com/receipt.jpg' });

    const purchases = await db.execute('SELECT * FROM purchases');
    expect(purchases.rows[0].store_name).toBe('イオン渋谷店');
  });
});
