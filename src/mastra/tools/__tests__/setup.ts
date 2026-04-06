import { initializeDatabase } from '../../db/schema.js';
import { db } from '../../db/client.js';

export async function setupTestDb() {
  await initializeDatabase();
}

export async function cleanupTestDb() {
  await db.executeMultiple(`
    DELETE FROM inventory;
    DELETE FROM meals;
    DELETE FROM preferences;
    DELETE FROM purchases;
  `);
}
