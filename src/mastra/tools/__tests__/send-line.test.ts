import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { sendLineTool } from '../send-line.js';

const { mockPushMessage, MockMessagingApiClient } = vi.hoisted(() => {
  const mockPushMessage = vi.fn().mockResolvedValue({});
  const MockMessagingApiClient = vi.fn(function (this: Record<string, unknown>) {
    this.pushMessage = mockPushMessage;
  });
  return { mockPushMessage, MockMessagingApiClient };
});

vi.mock('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: MockMessagingApiClient,
  },
}));

const execute = sendLineTool.execute!;

describe('send-line', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPushMessage.mockResolvedValue({});
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.LINE_USER_ID;
  });

  afterEach(() => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.LINE_USER_ID;
  });

  it('LINE_CHANNEL_ACCESS_TOKEN未設定の場合エラーを返す', async () => {
    const result = await execute({ message: 'こんにちは' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('LINE_CHANNEL_ACCESS_TOKEN');
    expect(mockPushMessage).not.toHaveBeenCalled();
  });

  it('user_idもLINE_USER_IDも未設定の場合エラーを返す', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';

    const result = await execute({ message: 'こんにちは' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('LINE_USER_ID');
    expect(mockPushMessage).not.toHaveBeenCalled();
  });

  it('LINE_USER_IDを使ってメッセージを送信できる', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    process.env.LINE_USER_ID = 'U1234567890';

    const result = await execute({ message: 'テストメッセージ' });

    expect(result.success).toBe(true);
    expect(result.message).toContain('送信しました');
    expect(mockPushMessage).toHaveBeenCalledWith({
      to: 'U1234567890',
      messages: [{ type: 'text', text: 'テストメッセージ' }],
    });
  });

  it('引数のuser_idが環境変数より優先される', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    process.env.LINE_USER_ID = 'U_env';

    const result = await execute({ message: 'テスト', user_id: 'U_custom' });

    expect(result.success).toBe(true);
    expect(mockPushMessage).toHaveBeenCalledWith({
      to: 'U_custom',
      messages: [{ type: 'text', text: 'テスト' }],
    });
  });
});
