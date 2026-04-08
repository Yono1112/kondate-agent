import { messagingApi } from '@line/bot-sdk';

export function createLineMessagingClient(
  channelAccessToken: string,
): messagingApi.MessagingApiClient {
  return new messagingApi.MessagingApiClient({ channelAccessToken });
}

/** ツール（send-line / send-line-buttons）用: channelAccessToken + targetUserId を解決 */
export function resolveLinePushCredentials(userId?: string):
  | { channelAccessToken: string; targetUserId: string }
  | { error: string } {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const targetUserId = userId ?? process.env.LINE_USER_ID;

  if (!channelAccessToken) {
    return { error: 'LINE_CHANNEL_ACCESS_TOKEN が設定されていません' };
  }
  if (!targetUserId) {
    return {
      error: '送信先ユーザーIDが指定されていません（LINE_USER_ID を設定してください）',
    };
  }

  return { channelAccessToken, targetUserId };
}

/** Webhook用: channelSecret + channelAccessToken を解決 */
export function resolveWebhookCredentials():
  | { channelSecret: string; channelAccessToken: string }
  | null {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelSecret || !channelAccessToken) return null;
  return { channelSecret, channelAccessToken };
}
