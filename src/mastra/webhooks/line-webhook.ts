import { registerApiRoute } from '@mastra/core/server';
import { validateSignature, webhook } from '@line/bot-sdk';
import { resolveWebhookCredentials, createLineMessagingClient } from '../utils/lineClient.js';

export const lineWebhookRoute = registerApiRoute('/webhooks/line', {
  method: 'POST',
  requiresAuth: false,
  handler: async (c) => {
    try {
      const lineCreds = resolveWebhookCredentials();
      if (!lineCreds) {
        return c.json({ error: 'LINE credentials not configured' }, 500);
      }

      // 署名検証
      const signature = c.req.header('x-line-signature') ?? '';
      const rawBody = await c.req.text();

      if (!validateSignature(rawBody, lineCreds.channelSecret, signature)) {
        return c.json({ error: 'Invalid signature' }, 401);
      }

      const body = JSON.parse(rawBody) as webhook.WebhookRequestBody;
      const lineClient = createLineMessagingClient(lineCreds.channelAccessToken);
      const mastra = c.get('mastra');
      const agent = mastra.getAgent('kondateAgent');

      // LINEには即座に200を返し、処理は背景で行う（webhookタイムアウト回避）
      const processEvents = Promise.all(
        body.events.map(async (event) => {
          if (event.type !== 'message') return;
          if (!('source' in event) || !event.source?.userId) return;

          const userId = event.source.userId;
          const replyToken =
            'replyToken' in event ? (event.replyToken as string) : undefined;

          // テキストメッセージ
          if (event.message.type === 'text') {
            const userMessage = (event.message as webhook.TextMessageContent).text;

            try {
              const response = await agent.generate(
                [{ role: 'user', content: `[userId:${userId}] ${userMessage}` }],
                {
                  threadId: `line-${userId}`,
                  resourceId: userId,
                },
              );

              const replyText = response.text ?? '';

              if (replyText.trim()) {
                if (replyToken) {
                  await lineClient.replyMessage({
                    replyToken,
                    messages: [{ type: 'text', text: replyText.slice(0, 5000) }],
                  });
                } else {
                  await lineClient.pushMessage({
                    to: userId,
                    messages: [{ type: 'text', text: replyText.slice(0, 5000) }],
                  });
                }
              }
            } catch (error) {
              console.error('Agent generation error:', error);
              if (replyToken) {
                await lineClient.replyMessage({
                  replyToken,
                  messages: [
                    {
                      type: 'text',
                      text: 'エラーが発生しました。もう一度お試しください。',
                    },
                  ],
                });
              }
            }
          }

          // 画像メッセージ（レシート）
          if (event.message.type === 'image') {
            const messageId = event.message.id;
            const imageUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`;

            try {
              const response = await agent.generate(
                [
                  {
                    role: 'user',
                    content: `[userId:${userId}] レシート画像が送られてきました。parse-receiptツールを使って解析してください。image_url: ${imageUrl}`,
                  },
                ],
                {
                  threadId: `line-${userId}`,
                  resourceId: userId,
                },
              );

              const replyText = response.text ?? '';

              if (replyText.trim()) {
                if (replyToken) {
                  await lineClient.replyMessage({
                    replyToken,
                    messages: [{ type: 'text', text: replyText.slice(0, 5000) }],
                  });
                } else {
                  await lineClient.pushMessage({
                    to: userId,
                    messages: [{ type: 'text', text: replyText.slice(0, 5000) }],
                  });
                }
              }
            } catch (error) {
              console.error('Receipt parsing error:', error);
              if (replyToken) {
                await lineClient.replyMessage({
                  replyToken,
                  messages: [
                    {
                      type: 'text',
                      text: 'レシートの読み取りに失敗しました。もう一度お試しください。',
                    },
                  ],
                });
              }
            }
          }
        }),
      );

      // バックグラウンドで処理を継続（エラーはログに残す）
      processEvents.catch((e) => {
        console.error('[line-webhook] background processing error:', e);
      });

      return c.json({ status: 'ok' });
    } catch (err) {
      console.error('[line-webhook] error:', err);
      return c.json({ error: 'internal' }, 500);
    }
  },
});
