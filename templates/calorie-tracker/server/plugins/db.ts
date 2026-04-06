import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      calories INTEGER NOT NULL DEFAULT 0,
      protein REAL,
      carbs REAL,
      fat REAL,
      date TEXT NOT NULL,
      image_url TEXT,
      notes TEXT,
      created_at INTEGER
    )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      calories_burned INTEGER NOT NULL DEFAULT 0,
      duration_minutes INTEGER,
      date TEXT NOT NULL,
      created_at INTEGER
    )`,
  },
  {
    version: 3,
    sql: `CREATE TABLE IF NOT EXISTS weights (
      id INTEGER PRIMARY KEY,
      weight REAL NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      created_at INTEGER
    )`,
  },
]);
