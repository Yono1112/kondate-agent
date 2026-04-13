import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchChannelVideos } from '../youtube.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('youtube utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('チャンネルIDから動画一覧を取得できる', async () => {
    // channels.list → uploadsプレイリストID取得
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            contentDetails: {
              relatedPlaylists: { uploads: 'UU_test_playlist' },
            },
          },
        ],
      }),
    });

    // playlistItems.list → 動画一覧取得
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            snippet: {
              title: 'テスト料理動画',
              description: '材料: 鶏むね肉, 醤油\n作り方: ...',
              resourceId: { videoId: 'video123' },
              channelTitle: 'テストチャンネル',
            },
          },
        ],
        nextPageToken: undefined,
      }),
    });

    const videos = await fetchChannelVideos('UC_test_channel', 'test-api-key', 5);

    expect(videos).toHaveLength(1);
    expect(videos[0].title).toBe('テスト料理動画');
    expect(videos[0].videoId).toBe('video123');
    expect(videos[0].channelTitle).toBe('テストチャンネル');
  });

  it('API キーが無効な場合エラーを返す', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    await expect(
      fetchChannelVideos('UC_test', 'bad-key', 5),
    ).rejects.toThrow();
  });
});
