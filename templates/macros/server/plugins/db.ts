import { runMigrations, isPostgres } from "@agent-native/core/db";

function pk(): string {
  return isPostgres() ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY";
}

function realType(): string {
  return isPostgres() ? "DOUBLE PRECISION" : "REAL";
}

export default runMigrations(
  [
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
      created_at TEXT
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
      created_at TEXT
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
      created_at TEXT
    )`;
      },
    },
    // v4: add owner_email for per-user data scoping
    {
      version: 4,
      get sql() {
        return `ALTER TABLE meals ADD COLUMN IF NOT EXISTS owner_email TEXT;
              ALTER TABLE exercises ADD COLUMN IF NOT EXISTS owner_email TEXT;
              ALTER TABLE weights ADD COLUMN IF NOT EXISTS owner_email TEXT;`;
      },
    },
    // v5: formerly changed created_at column types in-place on Postgres.
    // Fresh tables now create created_at as TEXT. Existing integer columns
    // need an explicit data migration plan; do not run a type-changing ALTER
    // automatically against shared production databases.
    {
      version: 5,
      get sql() {
        return `SELECT 1`;
      },
    },
    // v6: formerly repaired rows after the v5 type change. It is retained as
    // a no-op so migration versions remain monotonic without mutating data.
    {
      version: 6,
      get sql() {
        return `SELECT 1`;
      },
    },
    // v7: align fresh databases with the Drizzle schema. user_id is kept as a
    // nullable legacy compatibility column; owner_email is the active scope.
    {
      version: 7,
      get sql() {
        return `ALTER TABLE meals ADD COLUMN IF NOT EXISTS user_id TEXT;
              ALTER TABLE exercises ADD COLUMN IF NOT EXISTS user_id TEXT;
              ALTER TABLE weights ADD COLUMN IF NOT EXISTS user_id TEXT;`;
      },
    },
    // v8: index the per-user list/history hot path. Every list and analytics
    // action filters by owner_email plus an equality or BETWEEN range on date
    // (list-meals / list-exercises / list-weights, meals-history,
    // weights-history, get-analytics). A composite (owner_email, date) index
    // covers both the single-day equality lookups and the date-range scans
    // without a full table scan as rows accumulate.
    {
      version: 8,
      get sql() {
        return `CREATE INDEX IF NOT EXISTS meals_owner_date_idx ON meals (owner_email, date);
              CREATE INDEX IF NOT EXISTS exercises_owner_date_idx ON exercises (owner_email, date);
              CREATE INDEX IF NOT EXISTS weights_owner_date_idx ON weights (owner_email, date);`;
      },
    },
  ],
  { table: "macros_migrations" },
);
