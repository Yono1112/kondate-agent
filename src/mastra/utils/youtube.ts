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
