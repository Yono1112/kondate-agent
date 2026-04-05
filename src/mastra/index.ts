import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { kondateAgent } from './agents/kondate-agent.js';
import { seedDatabase } from './db/seed.js';
import { lineWebhookRoute } from './webhooks/line-webhook.js';

// DB初期化（テーブル作成・デフォルトデータ投入）
await seedDatabase();

export const mastra = new Mastra({
  agents: { kondateAgent },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: 'file:./mastra.db',
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  server: {
    apiRoutes: [lineWebhookRoute],
  },
});
