import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { resolveLinePushCredentials, createLineMessagingClient } from '../utils/lineClient.js';

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
    const creds = resolveLinePushCredentials(user_id);
    if ('error' in creds) return { success: false, message: creds.error };

    const client = createLineMessagingClient(creds.channelAccessToken);
    await client.pushMessage({
      to: creds.targetUserId,
      messages: [{ type: 'text', text: message }],
    });

    return { success: true, message: 'LINEメッセージを送信しました' };
  },
});
