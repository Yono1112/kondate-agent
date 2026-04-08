import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { messagingApi } from '@line/bot-sdk';
import { resolveLinePushCredentials, createLineMessagingClient } from '../utils/lineClient.js';

export const sendLineButtonsTool = createTool({
  id: 'send-line-buttons',
  description:
    'LINEのButtons Templateでボタン付きメッセージを送信します。献立提案など選択肢を提示するとき、またはレシート解析・食事記録・消費期限チェック完了後にネクストアクションを案内するときに使います。',
  inputSchema: z.object({
    title: z
      .string()
      .max(40, 'titleは40文字以内にしてください')
      .optional()
      .describe('テンプレートのタイトル（最大40文字）'),
    text: z
      .string()
      .min(1)
      .max(60, 'textは60文字以内にしてください')
      .describe('メインテキスト（最大60文字）'),
    buttons: z
      .array(
        z.object({
          label: z
            .string()
            .min(1)
            .max(20, 'ボタンのラベルは20文字以内にしてください')
            .describe('ボタンのラベル（最大20文字）'),
          text: z
            .string()
            .min(1)
            .max(300)
            .describe('ボタンタップ時にユーザーの発言として送信されるテキスト'),
        }),
      )
      .min(1)
      .max(4, 'ボタンは最大4個までです')
      .describe('ボタン配列（最大4個）'),
    user_id: z
      .string()
      .optional()
      .describe('送信先LINEユーザーID（省略時はLINE_USER_ID環境変数を使用）'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ title, text, buttons, user_id }) => {
    const creds = resolveLinePushCredentials(user_id);
    if ('error' in creds) return { success: false, message: creds.error };

    const client = createLineMessagingClient(creds.channelAccessToken);

    const actions: messagingApi.MessageAction[] = buttons.map((btn) => ({
      type: 'message',
      label: btn.label.slice(0, 20),
      text: btn.text,
    }));

    const templateMessage: messagingApi.TemplateMessage = {
      type: 'template',
      altText: title ?? text,
      template: {
        type: 'buttons',
        ...(title ? { title } : {}),
        text,
        actions,
      },
    };

    await client.pushMessage({
      to: creds.targetUserId,
      messages: [templateMessage],
    });

    return { success: true, message: 'ボタンテンプレートメッセージを送信しました' };
  },
});
