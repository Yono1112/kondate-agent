import { createClient } from '@libsql/client';

export const db = createClient({
  url: process.env.KONDATE_DB_URL ?? 'file:./kondate.db',
});
