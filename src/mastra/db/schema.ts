import { db } from './client.js';

export async function initializeDatabase(): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      expiry_date TEXT,
      purchased_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
      dish_name TEXT NOT NULL,
      ingredients TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS preferences (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      store_name TEXT,
      item_name TEXT NOT NULL,
      price INTEGER,
      quantity REAL,
      unit TEXT,
      purchased_at TEXT NOT NULL,
      receipt_image_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      video_id TEXT NOT NULL UNIQUE,
      video_url TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      ingredients TEXT NOT NULL DEFAULT '[]',
      cook_time_minutes INTEGER,
      category TEXT,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
