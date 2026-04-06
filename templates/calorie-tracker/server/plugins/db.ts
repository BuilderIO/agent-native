import { runMigrations, isPostgres } from "@agent-native/core/db";

function pk(): string {
  return isPostgres() ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY";
}

function realType(): string {
  return isPostgres() ? "DOUBLE PRECISION" : "REAL";
}

export default runMigrations([
  {
    version: 1,
    get sql() {
      return `CREATE TABLE IF NOT EXISTS meals (
      id ${pk()},
      name TEXT NOT NULL,
      calories INTEGER NOT NULL DEFAULT 0,
      protein ${realType()},
      carbs ${realType()},
      fat ${realType()},
      date TEXT NOT NULL,
      image_url TEXT,
      notes TEXT,
      created_at INTEGER
    )`;
    },
  },
  {
    version: 2,
    get sql() {
      return `CREATE TABLE IF NOT EXISTS exercises (
      id ${pk()},
      name TEXT NOT NULL,
      calories_burned INTEGER NOT NULL DEFAULT 0,
      duration_minutes INTEGER,
      date TEXT NOT NULL,
      created_at INTEGER
    )`;
    },
  },
  {
    version: 3,
    get sql() {
      return `CREATE TABLE IF NOT EXISTS weights (
      id ${pk()},
      weight ${realType()} NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      created_at INTEGER
    )`;
    },
  },
]);
