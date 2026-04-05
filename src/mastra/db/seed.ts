import { db } from './client.js';
import { initializeDatabase } from './schema.js';

const defaultPreferences = [
  {
    id: 'pref-priority',
    key: 'priority',
    value: JSON.stringify({ nutrition: 3, ease: 3, cost: 3, variety: 3 }),
  },
  {
    id: 'pref-household',
    key: 'household',
    value: JSON.stringify({ adults: 1, children: 0 }),
  },
  {
    id: 'pref-allergies',
    key: 'allergies',
    value: JSON.stringify([]),
  },
  {
    id: 'pref-dislikes',
    key: 'dislikes',
    value: JSON.stringify([]),
  },
];

export async function seedDatabase(): Promise<void> {
  await initializeDatabase();

  for (const pref of defaultPreferences) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO preferences (id, key, value) VALUES (?, ?, ?)`,
      args: [pref.id, pref.key, pref.value],
    });
  }
}
