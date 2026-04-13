import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchChannelVideos, searchChannelVideos } from '../youtube.js';

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

describe('searchChannelVideos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('再生回数順で動画を取得できる', async () => {
    // search API → video IDs
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { id: { videoId: 'popular1' } },
          { id: { videoId: 'popular2' } },
        ],
        nextPageToken: undefined,
      }),
    });

    // videos.list → 詳細取得
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'popular1',
            snippet: {
              title: '人気動画1',
              description: '説明1',
              channelTitle: 'テストチャンネル',
            },
          },
          {
            id: 'popular2',
            snippet: {
              title: '人気動画2',
              description: '説明2',
              channelTitle: 'テストチャンネル',
            },
          },
        ],
      }),
    });

    const videos = await searchChannelVideos('UC_test', 'test-key', 2, 0);

    expect(videos).toHaveLength(2);
    expect(videos[0].title).toBe('人気動画1');
    expect(videos[1].videoId).toBe('popular2');

    // search API が viewCount 順で呼ばれていることを確認
    const searchCall = mockFetch.mock.calls[0][0] as string;
    expect(searchCall).toContain('order=viewCount');
    expect(searchCall).toContain('channelId=UC_test');
  });

  it('offset で先頭をスキップできる', async () => {
    // search API → 3件取得（offset=1, max=2 なので合計3件必要）
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { id: { videoId: 'top1' } },
          { id: { videoId: 'top2' } },
          { id: { videoId: 'top3' } },
        ],
        nextPageToken: undefined,
      }),
    });

    // videos.list → top2, top3 の詳細
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'top2',
            snippet: {
              title: '2位の動画',
              description: '説明2',
              channelTitle: 'テストch',
            },
          },
          {
            id: 'top3',
            snippet: {
              title: '3位の動画',
              description: '説明3',
              channelTitle: 'テストch',
            },
          },
        ],
      }),
    });

    const videos = await searchChannelVideos('UC_test', 'test-key', 2, 1);

    expect(videos).toHaveLength(2);
    expect(videos[0].videoId).toBe('top2');
    expect(videos[1].videoId).toBe('top3');
  });

  it('Search API エラー時に例外を投げる', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    await expect(
      searchChannelVideos('UC_test', 'bad-key', 5, 0),
    ).rejects.toThrow('YouTube search API error');
  });
});
