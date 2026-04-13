export interface YouTubeVideoSnippet {
  title: string;
  description: string;
  videoId: string;
  channelTitle: string;
}

const API_BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * チャンネル ID から uploads プレイリスト ID を取得する
 */
async function getUploadsPlaylistId(
  channelId: string,
  apiKey: string,
): Promise<string> {
  const url = `${API_BASE}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`YouTube channels API error: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    items?: { contentDetails: { relatedPlaylists: { uploads: string } } }[];
  };
  const playlistId = data.items?.[0]?.contentDetails.relatedPlaylists.uploads;
  if (!playlistId) {
    throw new Error(`チャンネル ${channelId} の uploads プレイリストが見つかりません`);
  }
  return playlistId;
}

/**
 * チャンネルの動画一覧（タイトル・説明文・動画ID）を取得する。
 * maxResults で取得上限を指定（デフォルト50）。
 */
export async function fetchChannelVideos(
  channelId: string,
  apiKey: string,
  maxResults: number = 50,
): Promise<YouTubeVideoSnippet[]> {
  const playlistId = await getUploadsPlaylistId(channelId, apiKey);

  const videos: YouTubeVideoSnippet[] = [];
  let pageToken: string | undefined;

  while (videos.length < maxResults) {
    const pageSize = Math.min(50, maxResults - videos.length);
    const url = new URL(`${API_BASE}/playlistItems`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', String(pageSize));
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`YouTube playlistItems API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      items: {
        snippet: {
          title: string;
          description: string;
          resourceId: { videoId: string };
          channelTitle: string;
        };
      }[];
      nextPageToken?: string;
    };

    for (const item of data.items) {
      videos.push({
        title: item.snippet.title,
        description: item.snippet.description,
        videoId: item.snippet.resourceId.videoId,
        channelTitle: item.snippet.channelTitle,
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return videos;
}

/**
 * YouTube Search API を使い、再生回数順でチャンネルの動画を取得する。
 * offset で先頭からスキップする件数を指定できる（ページ送りで実現）。
 */
export async function searchChannelVideos(
  channelId: string,
  apiKey: string,
  maxResults: number = 50,
  offset: number = 0,
): Promise<YouTubeVideoSnippet[]> {
  // offset + maxResults 分だけ Search API で取得し、先頭 offset 件を捨てる
  const totalNeeded = offset + maxResults;
  const videoIds: string[] = [];
  let pageToken: string | undefined;

  while (videoIds.length < totalNeeded) {
    const pageSize = Math.min(50, totalNeeded - videoIds.length);
    const url = new URL(`${API_BASE}/search`);
    url.searchParams.set('part', 'id');
    url.searchParams.set('channelId', channelId);
    url.searchParams.set('type', 'video');
    url.searchParams.set('order', 'viewCount');
    url.searchParams.set('maxResults', String(pageSize));
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(
        `YouTube search API error: ${res.status} ${res.statusText}`,
      );
    }

    const data = (await res.json()) as {
      items: { id: { videoId: string } }[];
      nextPageToken?: string;
    };

    for (const item of data.items) {
      videoIds.push(item.id.videoId);
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  // offset 適用
  const targetIds = videoIds.slice(offset, offset + maxResults);
  if (targetIds.length === 0) return [];

  // videos.list で詳細（タイトル・説明文）を一括取得（50件ずつ）
  const videos: YouTubeVideoSnippet[] = [];
  for (let i = 0; i < targetIds.length; i += 50) {
    const chunk = targetIds.slice(i, i + 50);
    const url = new URL(`${API_BASE}/videos`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('id', chunk.join(','));
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(
        `YouTube videos API error: ${res.status} ${res.statusText}`,
      );
    }

    const data = (await res.json()) as {
      items: {
        id: string;
        snippet: {
          title: string;
          description: string;
          channelTitle: string;
        };
      }[];
    };

    for (const item of data.items) {
      videos.push({
        title: item.snippet.title,
        description: item.snippet.description,
        videoId: item.id,
        channelTitle: item.snippet.channelTitle,
      });
    }
  }

  return videos;
}
