import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { importRecipesTool } from '../import-recipes.js';
import { setupTestDb, cleanupTestDb } from './setup.js';
import { db } from '../../db/client.js';

const execute = importRecipesTool.execute!;

// YouTube API をモック
vi.mock('../../utils/youtube.js', () => ({
  fetchChannelVideos: vi.fn().mockResolvedValue([
    {
      title: '【簡単】鶏むね肉の照り焼き',
      description: '材料（2人前）\n・鶏むね肉 300g\n・醤油 大さじ2\n・みりん 大さじ2\n\n調理時間: 約20分',
      videoId: 'abc123',
      channelTitle: '料理チャンネル',
    },
    {
      title: 'Vlog: 週末のお出かけ',
      description: '今日は渋谷に行ってきました！',
      videoId: 'xyz789',
      channelTitle: '料理チャンネル',
    },
  ]),
}));

describe('import-recipes', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
    vi.stubEnv('YOUTUBE_API_KEY', 'test-key');
  });

  it('YOUTUBE_API_KEY が未設定の場合エラーを返す', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', '');

    const result = await execute({ channel_id: 'UC_test' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('YOUTUBE_API_KEY');
  });

  it('同じ動画を重複取り込みしない', async () => {
    // 手動でレシピを挿入（abc123 の video_id で）
    await db.execute({
      sql: `INSERT INTO recipes (id, title, channel_name, channel_id, video_id, video_url, description, ingredients, category, summary)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'recipe-existing',
        '既存レシピ',
        '料理チャンネル',
        'UC_test',
        'abc123',
        'https://www.youtube.com/watch?v=abc123',
        'テスト',
        '[]',
        '主菜',
        'テスト',
      ],
    });

    const result = await execute({ channel_id: 'UC_test', max_videos: 10 });

    // abc123 はスキップされるはず
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });
});
