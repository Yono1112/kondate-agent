# Phase 3: レシピ機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** YouTube チャンネルからレシピを取り込み、食材・調理時間・カテゴリで検索できる `search-recipes` ツールを追加する

**Architecture:** LibSQL にレシピテーブルを追加し、YouTube Data API v3 でチャンネルの動画情報（タイトル + 概要欄）を取得、LLM（GLM-5）で構造化して DB に保存する。RAG/ベクトル検索は導入せず、SQL 検索のみで「さっぱりしたもの」等の曖昧クエリはエージェント（LLM）が SQL 条件に変換して対応する。字幕は YouTube API では第三者動画から取得不可（OAuth + オーナー権限必須）のため、概要欄テキストのみを利用する。

**Tech Stack:** LibSQL, YouTube Data API v3 (API キーのみ), Z.AI GLM-5, Zod, Vitest

---

## File Structure

### 新規作成

| ファイル | 責務 |
|---|---|
| `src/mastra/utils/youtube.ts` | YouTube Data API v3 のヘルパー（チャンネルの動画一覧取得。タイトル + 概要欄のみ、字幕は不可） |
| `src/mastra/tools/search-recipes.ts` | 食材・調理時間・カテゴリ・キーワードで recipes テーブルを SQL 検索 |
| `src/mastra/tools/import-recipes.ts` | YouTube チャンネルからレシピを一括取り込み（YouTube API → LLM 構造化 → DB 保存） |
| `src/mastra/tools/__tests__/search-recipes.test.ts` | search-recipes ツールのテスト |
| `src/mastra/tools/__tests__/import-recipes.test.ts` | import-recipes ツールのテスト（YouTube API をモック） |
| `src/mastra/utils/__tests__/youtube.test.ts` | YouTube API ヘルパーのテスト（fetch をモック） |

### 修正

| ファイル | 修正内容 |
|---|---|
| `src/mastra/db/schema.ts` | `recipes` テーブルの CREATE TABLE を追加 |
| `src/mastra/utils/dbSchemas.ts` | `recipeRowSchema` と `parseRecipeRow` を追加 |
| `src/mastra/tools/__tests__/setup.ts` | `cleanupTestDb` に `DELETE FROM recipes` を追加 |
| `src/mastra/agents/kondate-agent.ts` | 新ツール2つを登録 + instructions にレシピ関連の指示を追加 |
| `src/mastra/index.ts` | 変更不要（ツールはエージェント経由で登録済み） |

---

## DB スキーマ: recipes テーブル

```sql
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  video_id TEXT NOT NULL UNIQUE,
  video_url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ingredients TEXT NOT NULL DEFAULT '[]',
  cook_time_minutes INTEGER,
  category TEXT,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- `description`: YouTube 概要欄の原文をそのまま保存。エージェントが「作り方教えて」に回答する際の情報源
- `ingredients`: JSON 文字列（`["鶏むね肉", "醤油", "みりん"]`）— LLM で構造化した検索用フィールド
- `category`: `主菜` / `副菜` / `汁物` / `主食` / `デザート` / `その他`
- `cook_time_minutes`: 調理時間（分）。不明な場合は NULL
- `video_id`: YouTube 動画 ID。UNIQUE 制約で重複取り込みを防止

## 環境変数

```
YOUTUBE_API_KEY=  # YouTube Data API v3 キー（import-recipes で必須）
```

---

### Task 1: recipes テーブルと Zod スキーマの追加

**Files:**
- Modify: `src/mastra/db/schema.ts`
- Modify: `src/mastra/utils/dbSchemas.ts`
- Modify: `src/mastra/tools/__tests__/setup.ts`

- [ ] **Step 1: `schema.ts` に recipes テーブルを追加**

`src/mastra/db/schema.ts` の `executeMultiple` 内に以下を追加:

```sql
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  video_id TEXT NOT NULL UNIQUE,
  video_url TEXT NOT NULL,
  ingredients TEXT NOT NULL DEFAULT '[]',
  cook_time_minutes INTEGER,
  category TEXT,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: `dbSchemas.ts` に recipeRowSchema を追加**

`src/mastra/utils/dbSchemas.ts` 末尾に追加:

```typescript
// RecipeRow

export const recipeRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  channel_name: z.string(),
  channel_id: z.string(),
  video_id: z.string(),
  video_url: z.string(),
  description: z.string(),
  ingredients: z.string(),
  cook_time_minutes: z.coerce.number().nullish().transform((v) => v ?? null),
  category: z.string().nullish().transform((v) => v ?? null),
  summary: z.string().nullish().transform((v) => v ?? null),
});

export type RecipeRow = z.infer<typeof recipeRowSchema>;

export function parseRecipeRow(row: Record<string, unknown>): RecipeRow {
  return recipeRowSchema.parse(row);
}
```

- [ ] **Step 3: `setup.ts` の cleanupTestDb に recipes を追加**

`src/mastra/tools/__tests__/setup.ts` の `cleanupTestDb` 内の `executeMultiple` に `DELETE FROM recipes;` を追加。

- [ ] **Step 4: テストとビルド確認**

Run: `source ~/.zshrc && nvm use 22 && npm run test`
Expected: 全テスト pass（既存テストが recipes テーブル追加で壊れていないことを確認）

- [ ] **Step 5: コミット**

```bash
git add src/mastra/db/schema.ts src/mastra/utils/dbSchemas.ts src/mastra/tools/__tests__/setup.ts
git commit -m "feat(db): recipes テーブルと RecipeRow Zod スキーマを追加"
```

---

### Task 2: YouTube API ヘルパー

**Files:**
- Create: `src/mastra/utils/youtube.ts`
- Create: `src/mastra/utils/__tests__/youtube.test.ts`

- [ ] **Step 1: テストファイルを作成**

`src/mastra/utils/__tests__/youtube.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchChannelVideos, type YouTubeVideoSnippet } from '../youtube.js';

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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `source ~/.zshrc && nvm use 22 && npx vitest run src/mastra/utils/__tests__/youtube.test.ts`
Expected: FAIL（`youtube.ts` がまだ存在しないため）

- [ ] **Step 3: YouTube API ヘルパーを実装**

`src/mastra/utils/youtube.ts`:

```typescript
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
```

- [ ] **Step 4: テストを実行して pass を確認**

Run: `source ~/.zshrc && nvm use 22 && npx vitest run src/mastra/utils/__tests__/youtube.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/mastra/utils/youtube.ts src/mastra/utils/__tests__/youtube.test.ts
git commit -m "feat(utils): YouTube Data API v3 ヘルパーを追加"
```

---

### Task 3: search-recipes ツール

**Files:**
- Create: `src/mastra/tools/search-recipes.ts`
- Create: `src/mastra/tools/__tests__/search-recipes.test.ts`

- [ ] **Step 1: テストファイルを作成**

`src/mastra/tools/__tests__/search-recipes.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { searchRecipesTool } from '../search-recipes.js';
import { setupTestDb, cleanupTestDb } from './setup.js';
import { db } from '../../db/client.js';

const execute = searchRecipesTool.execute!;

async function insertRecipe(overrides: Partial<{
  id: string;
  title: string;
  channel_name: string;
  channel_id: string;
  video_id: string;
  video_url: string;
  description: string;
  ingredients: string;
  cook_time_minutes: number | null;
  category: string | null;
  summary: string | null;
}> = {}) {
  const defaults = {
    id: `recipe-${crypto.randomUUID()}`,
    title: 'テスト料理',
    channel_name: 'テストチャンネル',
    channel_id: 'UC_test',
    video_id: `vid-${crypto.randomUUID()}`,
    video_url: 'https://youtube.com/watch?v=test',
    description: '材料: 鶏むね肉, 醤油, みりん\n作り方: ...',
    ingredients: JSON.stringify(['鶏むね肉', '醤油', 'みりん']),
    cook_time_minutes: 30,
    category: '主菜',
    summary: '簡単な鶏むね肉料理',
  };
  const r = { ...defaults, ...overrides };
  await db.execute({
    sql: `INSERT INTO recipes (id, title, channel_name, channel_id, video_id, video_url, description, ingredients, cook_time_minutes, category, summary)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [r.id, r.title, r.channel_name, r.channel_id, r.video_id, r.video_url, r.description, r.ingredients, r.cook_time_minutes, r.category, r.summary],
  });
}

describe('search-recipes', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
  });

  it('キーワードでレシピを検索できる', async () => {
    await insertRecipe({ title: '鶏むね肉の照り焼き' });
    await insertRecipe({ title: 'サバの味噌煮' });

    const result = await execute({ keyword: '照り焼き' });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].title).toBe('鶏むね肉の照り焼き');
  });

  it('食材で検索できる', async () => {
    await insertRecipe({
      title: '鶏むね肉ソテー',
      ingredients: JSON.stringify(['鶏むね肉', '塩', 'こしょう']),
    });
    await insertRecipe({
      title: '豚しょうが焼き',
      ingredients: JSON.stringify(['豚ロース', 'しょうが', '醤油']),
    });

    const result = await execute({ ingredient: '鶏むね肉' });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].title).toBe('鶏むね肉ソテー');
  });

  it('カテゴリで絞り込みできる', async () => {
    await insertRecipe({ title: '味噌汁', category: '汁物' });
    await insertRecipe({ title: 'ステーキ', category: '主菜' });

    const result = await execute({ category: '汁物' });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].title).toBe('味噌汁');
  });

  it('調理時間で絞り込みできる', async () => {
    await insertRecipe({ title: '簡単サラダ', cook_time_minutes: 10 });
    await insertRecipe({ title: '煮込みカレー', cook_time_minutes: 60 });

    const result = await execute({ max_cook_time: 30 });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].title).toBe('簡単サラダ');
  });

  it('該当なしの場合メッセージを返す', async () => {
    const result = await execute({ keyword: '存在しないレシピ' });

    expect(result.recipes).toHaveLength(0);
    expect(result.message).toContain('見つかりませんでした');
  });

  it('条件なしで全レシピを返す', async () => {
    await insertRecipe({ title: 'レシピA' });
    await insertRecipe({ title: 'レシピB' });

    const result = await execute({});

    expect(result.recipes).toHaveLength(2);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `source ~/.zshrc && nvm use 22 && npx vitest run src/mastra/tools/__tests__/search-recipes.test.ts`
Expected: FAIL（`search-recipes.ts` がまだ存在しないため）

- [ ] **Step 3: search-recipes ツールを実装**

`src/mastra/tools/search-recipes.ts`:

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '../db/client.js';
import { parseRecipeRow } from '../utils/dbSchemas.js';

export const searchRecipesTool = createTool({
  id: 'search-recipes',
  description:
    'レシピを検索します。食材名・調理時間・カテゴリ・キーワードで絞り込みできます。',
  inputSchema: z.object({
    keyword: z.string().optional().describe('料理名やサマリーで検索するキーワード'),
    ingredient: z.string().optional().describe('食材名で検索（JSON配列内を部分一致）'),
    category: z
      .string()
      .optional()
      .describe('カテゴリ（主菜, 副菜, 汁物, 主食, デザート, その他）'),
    max_cook_time: z
      .number()
      .optional()
      .describe('最大調理時間（分）'),
  }),
  outputSchema: z.object({
    recipes: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        channel_name: z.string(),
        video_url: z.string(),
        description: z.string(),
        ingredients: z.array(z.string()),
        cook_time_minutes: z.number().nullable(),
        category: z.string().nullable(),
        summary: z.string().nullable(),
      }),
    ),
    message: z.string(),
  }),
  execute: async ({ keyword, ingredient, category, max_cook_time }) => {
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    if (keyword) {
      conditions.push('(title LIKE ? OR summary LIKE ?)');
      args.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (ingredient) {
      conditions.push('ingredients LIKE ?');
      args.push(`%${ingredient}%`);
    }
    if (category) {
      conditions.push('category = ?');
      args.push(category);
    }
    if (max_cook_time !== undefined) {
      conditions.push('cook_time_minutes IS NOT NULL AND cook_time_minutes <= ?');
      args.push(max_cook_time);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.execute({
      sql: `SELECT * FROM recipes ${where} ORDER BY title ASC LIMIT 20`,
      args,
    });

    const recipes = result.rows.map((row) => {
      const parsed = parseRecipeRow(row as Record<string, unknown>);
      let ingredientsList: string[] = [];
      try {
        ingredientsList = JSON.parse(parsed.ingredients);
      } catch {
        ingredientsList = [];
      }
      return {
        id: parsed.id,
        title: parsed.title,
        channel_name: parsed.channel_name,
        video_url: parsed.video_url,
        description: parsed.description,
        ingredients: ingredientsList,
        cook_time_minutes: parsed.cook_time_minutes,
        category: parsed.category,
        summary: parsed.summary,
      };
    });

    return {
      recipes,
      message:
        recipes.length === 0
          ? '該当するレシピが見つかりませんでした'
          : `${recipes.length}件のレシピが見つかりました`,
    };
  },
});
```

- [ ] **Step 4: テストを実行して pass を確認**

Run: `source ~/.zshrc && nvm use 22 && npx vitest run src/mastra/tools/__tests__/search-recipes.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/mastra/tools/search-recipes.ts src/mastra/tools/__tests__/search-recipes.test.ts
git commit -m "feat(tools): search-recipes ツールを追加（食材・時間・カテゴリ・キーワード検索）"
```

---

### Task 4: import-recipes ツール

**Files:**
- Create: `src/mastra/tools/import-recipes.ts`
- Create: `src/mastra/tools/__tests__/import-recipes.test.ts`

- [ ] **Step 1: テストファイルを作成**

`src/mastra/tools/__tests__/import-recipes.test.ts`:

```typescript
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

  it('チャンネルからレシピを取り込める', async () => {
    const result = await execute({
      channel_id: 'UC_test',
      max_videos: 10,
    });

    expect(result.success).toBe(true);
    expect(result.imported).toBeGreaterThanOrEqual(1);

    // DB にレシピが保存されている
    const dbResult = await db.execute('SELECT * FROM recipes');
    expect(dbResult.rows.length).toBeGreaterThanOrEqual(1);
    // レシピの動画だけ取り込まれ、Vlog は除外される
    const titles = dbResult.rows.map((r) => r.title);
    expect(titles).not.toContain('Vlog: 週末のお出かけ');
  });

  it('YOUTUBE_API_KEY が未設定の場合エラーを返す', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', '');

    const result = await execute({ channel_id: 'UC_test' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('YOUTUBE_API_KEY');
  });

  it('同じ動画を重複取り込みしない', async () => {
    await execute({ channel_id: 'UC_test', max_videos: 10 });
    const firstCount = (await db.execute('SELECT * FROM recipes')).rows.length;

    await execute({ channel_id: 'UC_test', max_videos: 10 });
    const secondCount = (await db.execute('SELECT * FROM recipes')).rows.length;

    expect(secondCount).toBe(firstCount);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `source ~/.zshrc && nvm use 22 && npx vitest run src/mastra/tools/__tests__/import-recipes.test.ts`
Expected: FAIL

- [ ] **Step 3: import-recipes ツールを実装**

`src/mastra/tools/import-recipes.ts`:

```typescript
import { createTool } from '@mastra/core/tools';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { db } from '../db/client.js';
import { fetchChannelVideos, type YouTubeVideoSnippet } from '../utils/youtube.js';

const recipeExtractorAgent = new Agent({
  id: 'recipe-extractor',
  name: 'レシピ抽出エージェント',
  instructions: `あなたは YouTube 動画の情報からレシピを構造化データとして抽出する専門エージェントです。
料理動画でない場合（Vlog、告知、雑談等）は is_recipe: false を返してください。`,
  model: 'zai/glm-5',
});

const recipeSchema = z.object({
  is_recipe: z.boolean().describe('料理レシピ動画かどうか'),
  title: z.string().describe('料理名（動画タイトルから抽出、装飾を除去）'),
  ingredients: z.array(z.string()).describe('材料名のリスト（分量は除く）'),
  cook_time_minutes: z
    .number()
    .nullable()
    .describe('調理時間（分）。不明なら null'),
  category: z
    .enum(['主菜', '副菜', '汁物', '主食', 'デザート', 'その他'])
    .describe('料理カテゴリ'),
  summary: z
    .string()
    .describe('レシピの簡単な説明（1-2文）'),
});

export const importRecipesTool = createTool({
  id: 'import-recipes',
  description:
    'YouTube チャンネルからレシピ動画を取り込み、recipes テーブルに保存します。',
  inputSchema: z.object({
    channel_id: z
      .string()
      .describe('YouTube チャンネル ID（UC で始まる文字列）'),
    max_videos: z
      .number()
      .optional()
      .default(50)
      .describe('取得する最大動画数（デフォルト50）'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    imported: z.number(),
    skipped: z.number(),
  }),
  execute: async ({ channel_id, max_videos }) => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        message: 'YOUTUBE_API_KEY が設定されていません',
        imported: 0,
        skipped: 0,
      };
    }

    const maxCount = max_videos ?? 50;
    let videos: YouTubeVideoSnippet[];
    try {
      videos = await fetchChannelVideos(channel_id, apiKey, maxCount);
    } catch (error) {
      return {
        success: false,
        message: `YouTube API エラー: ${error instanceof Error ? error.message : String(error)}`,
        imported: 0,
        skipped: 0,
      };
    }

    let imported = 0;
    let skipped = 0;

    for (const video of videos) {
      // 重複チェック
      const existing = await db.execute({
        sql: 'SELECT id FROM recipes WHERE video_id = ?',
        args: [video.videoId],
      });
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      // LLM で構造化
      try {
        const result = await recipeExtractorAgent.generate(
          [
            {
              role: 'user',
              content: `以下の YouTube 動画情報からレシピを抽出してください。\n\nタイトル: ${video.title}\n\n説明文:\n${video.description}`,
            },
          ],
          { structuredOutput: { schema: recipeSchema } },
        );

        const recipe = result.object;
        if (!recipe || !recipe.is_recipe) {
          skipped++;
          continue;
        }

        const id = `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await db.execute({
          sql: `INSERT OR IGNORE INTO recipes (id, title, channel_name, channel_id, video_id, video_url, description, ingredients, cook_time_minutes, category, summary)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            id,
            recipe.title,
            video.channelTitle,
            channel_id,
            video.videoId,
            `https://www.youtube.com/watch?v=${video.videoId}`,
            video.description,
            JSON.stringify(recipe.ingredients),
            recipe.cook_time_minutes,
            recipe.category,
            recipe.summary,
          ],
        });
        imported++;
      } catch {
        skipped++;
      }
    }

    return {
      success: true,
      message: `${imported}件のレシピを取り込みました（${skipped}件スキップ）`,
      imported,
      skipped,
    };
  },
});
```

- [ ] **Step 4: テストを実行して pass を確認**

Run: `source ~/.zshrc && nvm use 22 && npx vitest run src/mastra/tools/__tests__/import-recipes.test.ts`
Expected: PASS

注意: `recipeExtractorAgent.generate` もモックが必要になる可能性がある。テスト失敗時は vi.mock で Agent をモックし、`is_recipe: true` を返すように調整する。

- [ ] **Step 5: コミット**

```bash
git add src/mastra/tools/import-recipes.ts src/mastra/tools/__tests__/import-recipes.test.ts
git commit -m "feat(tools): import-recipes ツールを追加（YouTube チャンネルからレシピ一括取り込み）"
```

---

### Task 5: エージェントにレシピツールを統合

**Files:**
- Modify: `src/mastra/agents/kondate-agent.ts`

- [ ] **Step 1: ツールのインポートと登録を追加**

`src/mastra/agents/kondate-agent.ts` のインポート部分に追加:

```typescript
import { searchRecipesTool } from '../tools/search-recipes.js';
import { importRecipesTool } from '../tools/import-recipes.js';
```

`tools` オブジェクトに追加:

```typescript
searchRecipesTool,
importRecipesTool,
```

- [ ] **Step 2: instructions にレシピ関連の指示を追加**

エージェントの `instructions` 内の `## 献立提案の手順` セクションの手順 1 の前に以下を挿入:

```
## レシピ検索
- search-recipes ツールで登録済みレシピを検索できます
- 献立提案時に在庫の食材名で search-recipes を呼び出し、マッチするレシピがあれば優先的に候補に含めてください
- ユーザーが「レシピを探して」「〇〇のレシピある？」と聞いたら search-recipes を使ってください
- import-recipes はユーザーが「レシピを取り込んで」「〇〇チャンネルのレシピを追加して」と依頼したときに使います
```

- [ ] **Step 3: ビルド確認**

Run: `source ~/.zshrc && nvm use 22 && npm run build`
Expected: Build successful

- [ ] **Step 4: 全テスト確認**

Run: `source ~/.zshrc && nvm use 22 && npm run test`
Expected: 全テスト pass

- [ ] **Step 5: コミット**

```bash
git add src/mastra/agents/kondate-agent.ts
git commit -m "feat(agent): search-recipes / import-recipes ツールをエージェントに統合"
```

---

### Task 6: README 更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README にレシピ機能のセクションを追加**

以下を追記:
- Phase 3 の概要（YouTube レシピ取り込み + SQL 検索）
- `YOUTUBE_API_KEY` 環境変数の説明
- `import-recipes` / `search-recipes` ツールの説明
- `recipes` テーブルの説明

- [ ] **Step 2: コミット**

```bash
git add README.md
git commit -m "docs(readme): Phase 3 レシピ機能を追記"
```

---

---

### Task 7: 再生回数順取得・オフセット指定の追加（追加実装）

**Files:**
- Modify: `src/mastra/utils/youtube.ts`
- Modify: `src/mastra/tools/import-recipes.ts`
- Modify: `src/mastra/utils/__tests__/youtube.test.ts`

- [x] **Step 1: `youtube.ts` に `searchChannelVideos()` 関数を追加**

YouTube Search API（`order=viewCount`）を使い、再生回数順でチャンネルの動画IDを取得。
`offset` で先頭からスキップする件数を指定可能（ページ送りで実現）。
`videos.list` API で詳細（タイトル・説明文）を一括取得。

- [x] **Step 2: `import-recipes.ts` に `sort` / `offset` パラメータを追加**

- `sort`: `'date'`（新着順、デフォルト）or `'viewCount'`（再生回数順）
- `offset`: 先頭からスキップする件数（例: 50で51件目から取得）。viewCount 時のみ有効
- `sort === 'viewCount'` の場合に `searchChannelVideos()` を呼び出す

- [x] **Step 3: テスト3件を追加**

- 再生回数順で取得できること（`order=viewCount` パラメータ確認）
- offset でスキップできること
- Search API エラー時に例外を投げること

- [x] **Step 4: コミット**

```bash
git commit -m "feat(tools): import-recipes に再生回数順取得・オフセット指定を追加"
```

**注意: Search API のクォータコスト**
Search API は 1リクエストあたり 100ユニット（playlistItems は 1ユニット）。
日次クォータ 10,000ユニットなので、search は 100回/日が上限。

---

## 検証

1. **ユニットテスト**: `npm run test` で全テスト pass
2. **型チェック**: `npx tsc --noEmit` で変更ファイルにエラーなし
3. **ビルド**: `npm run build` が成功
4. **手動スモークテスト**（`npm run dev` → Mastra Studio）:
   - `search-recipes` ツール: 空検索 / キーワード検索 / カテゴリ検索で期待通りの結果
   - `import-recipes` ツール: テスト用チャンネル ID で実行し、レシピが DB に保存される
   - `import-recipes` ツール: `sort=viewCount` + `offset` で再生回数順ページ送りが動作すること
   - 献立提案時にレシピが考慮されること
