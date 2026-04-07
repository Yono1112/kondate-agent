import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { lineWebhookRoute } from '../../webhooks/line-webhook.js';

const { mockValidateSignature, mockReplyMessage, mockPushMessage, MockMessagingApiClient } =
  vi.hoisted(() => {
    const mockValidateSignature = vi.fn();
    const mockReplyMessage = vi.fn().mockResolvedValue({});
    const mockPushMessage = vi.fn().mockResolvedValue({});
    const MockMessagingApiClient = vi.fn(function (this: Record<string, unknown>) {
      this.replyMessage = mockReplyMessage;
      this.pushMessage = mockPushMessage;
    });
    return { mockValidateSignature, mockReplyMessage, mockPushMessage, MockMessagingApiClient };
  });

vi.mock('@line/bot-sdk', () => ({
  validateSignature: mockValidateSignature,
  webhook: {},
  messagingApi: {
    MessagingApiClient: MockMessagingApiClient,
  },
}));

// テスト用Honoアプリを作成するヘルパー
function buildApp(mockMastra: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).set('mastra', mockMastra);
    await next();
  });
  if ('handler' in lineWebhookRoute) {
    app.post('/webhooks/line', lineWebhookRoute.handler);
  }
  return app;
}

function makeWebhookBody(events: unknown[]) {
  return JSON.stringify({ destination: 'Utest', events });
}

function makeTextEvent(text: string, userId = 'U_test_user') {
  return {
    type: 'message',
    replyToken: 'test-reply-token',
    source: { type: 'user', userId },
    message: { type: 'text', id: 'msg001', text },
  };
}

function makeImageEvent(messageId: string, userId = 'U_test_user') {
  return {
    type: 'message',
    replyToken: 'test-reply-token',
    source: { type: 'user', userId },
    message: { type: 'image', id: messageId },
  };
}

describe('line-webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplyMessage.mockResolvedValue({});
    mockPushMessage.mockResolvedValue({});
    process.env.LINE_CHANNEL_SECRET = 'test-secret';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  });

  it('環境変数が未設定の場合500を返す', async () => {
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

    const app = buildApp({});
    const res = await app.request('/webhooks/line', {
      method: 'POST',
      body: '{}',
      headers: { 'x-line-signature': 'any', 'content-type': 'application/json' },
    });

    expect(res.status).toBe(500);
  });

  it('署名検証が失敗した場合401を返す', async () => {
    mockValidateSignature.mockReturnValue(false);

    const app = buildApp({});
    const res = await app.request('/webhooks/line', {
      method: 'POST',
      body: makeWebhookBody([]),
      headers: { 'x-line-signature': 'bad-sig', 'content-type': 'application/json' },
    });

    expect(res.status).toBe(401);
  });

  it('テキストメッセージを受信するとエージェントが呼ばれLINEに返信する', async () => {
    mockValidateSignature.mockReturnValue(true);

    const mockGenerate = vi
      .fn()
      .mockResolvedValue({ text: '夕飯は鶏むね肉の照り焼きはいかがですか？' });
    const mockMastra = { getAgent: vi.fn().mockReturnValue({ generate: mockGenerate }) };

    const app = buildApp(mockMastra);
    const res = await app.request('/webhooks/line', {
      method: 'POST',
      body: makeWebhookBody([makeTextEvent('今日の夕飯は何がいい？')]),
      headers: { 'x-line-signature': 'valid-sig', 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(mockGenerate).toHaveBeenCalledWith(
      [{ role: 'user', content: '今日の夕飯は何がいい？' }],
      expect.objectContaining({ threadId: 'line-U_test_user', resourceId: 'U_test_user' }),
    );
    expect(mockReplyMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToken: 'test-reply-token',
        messages: [{ type: 'text', text: '夕飯は鶏むね肉の照り焼きはいかがですか？' }],
      }),
    );
  });

  it('画像メッセージを受信するとparse-receiptプロンプトでエージェントが呼ばれる', async () => {
    mockValidateSignature.mockReturnValue(true);

    const mockGenerate = vi
      .fn()
      .mockResolvedValue({ text: 'レシートから3品の食材を追加しました' });
    const mockMastra = { getAgent: vi.fn().mockReturnValue({ generate: mockGenerate }) };

    const app = buildApp(mockMastra);
    const res = await app.request('/webhooks/line', {
      method: 'POST',
      body: makeWebhookBody([makeImageEvent('img_msg_001')]),
      headers: { 'x-line-signature': 'valid-sig', 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('parse-receipt') }),
      ]),
      expect.objectContaining({ threadId: 'line-U_test_user' }),
    );
    expect(mockReplyMessage).toHaveBeenCalled();
  });
});
