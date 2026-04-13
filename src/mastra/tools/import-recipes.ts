import { createTool } from '@mastra/core/tools';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { db } from '../db/client.js';
import { fetchChannelVideos, searchChannelVideos } from '../utils/youtube.js';

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
    sort: z
      .enum(['date', 'viewCount'])
      .optional()
      .default('date')
      .describe('並び順。date=新着順（デフォルト）、viewCount=再生回数順'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('先頭からスキップする件数（例: 50で51件目から取得）。viewCount 時のみ有効'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    imported: z.number(),
    skipped: z.number(),
  }),
  execute: async ({ channel_id, max_videos, sort, offset }) => {
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
    const sortOrder = sort ?? 'date';
    const skipCount = offset ?? 0;
    let videos;
    try {
      if (sortOrder === 'viewCount') {
        videos = await searchChannelVideos(channel_id, apiKey, maxCount, skipCount);
      } else {
        videos = await fetchChannelVideos(channel_id, apiKey, maxCount);
      }
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
