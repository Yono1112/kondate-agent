import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { messagingApi } from '@line/bot-sdk';

export const sendLineTool = createTool({
  id: 'send-line',
  description: 'LINEのPush APIを使ってユーザーにメッセージを送信します。',
  inputSchema: z.object({
    message: z.string().describe('送信するメッセージ'),
    user_id: z
      .string()
      .optional()
      .describe('送信先LINEユーザーID（省略時はLINE_USER_ID環境変数を使用）'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ message, user_id }) => {
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetUserId = user_id ?? process.env.LINE_USER_ID;

    if (!channelAccessToken) {
      return { success: false, message: 'LINE_CHANNEL_ACCESS_TOKEN が設定されていません' };
    }
    if (!targetUserId) {
      return {
        success: false,
        message: '送信先ユーザーIDが指定されていません（LINE_USER_ID を設定してください）',
      };
    }

    const client = new messagingApi.MessagingApiClient({ channelAccessToken });

    await client.pushMessage({
      to: targetUserId,
      messages: [{ type: 'text', text: message }],
    });

    return { success: true, message: 'LINEメッセージを送信しました' };
  },
});
