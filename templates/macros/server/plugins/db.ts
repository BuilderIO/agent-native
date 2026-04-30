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
    // v4: add owner_email for per-user data scoping
    {
      version: 4,
      get sql() {
        return `ALTER TABLE meals ADD COLUMN IF NOT EXISTS owner_email TEXT;
              ALTER TABLE exercises ADD COLUMN IF NOT EXISTS owner_email TEXT;
              ALTER TABLE weights ADD COLUMN IF NOT EXISTS owner_email TEXT;`;
      },
    },
    // v5: ensure created_at is TEXT (ISO timestamp) on Postgres.
    // The schema now stores ISO strings via $defaultFn(() => new Date().toISOString()).
    // Use USING to convert any existing INTEGER/timestamp values to text.
    // For SQLite, the column type is dynamic so no migration is needed.
    {
      version: 5,
      get sql() {
        if (isPostgres()) {
          return `
          ALTER TABLE meals ALTER COLUMN created_at TYPE TEXT USING created_at::text;
          ALTER TABLE exercises ALTER COLUMN created_at TYPE TEXT USING created_at::text;
          ALTER TABLE weights ALTER COLUMN created_at TYPE TEXT USING created_at::text;
        `;
        }
        return `SELECT 1`;
      },
    },
    // v6: repair rows where v5 left created_at as a stringified epoch (e.g.
    // "1704067200000") instead of an ISO timestamp. Lexicographic ORDER BY
    // can't mix these with new ISO values, so we convert any all-digit
    // strings to ISO via to_timestamp(epoch_ms / 1000.0). Only touches rows
    // matching ^[0-9]+$ so ISO strings written by new code are left alone.
    {
      version: 6,
      get sql() {
        if (isPostgres()) {
          const iso = (tbl: string) =>
            `UPDATE ${tbl} SET created_at = to_char(to_timestamp(created_at::bigint / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE created_at ~ '^[0-9]+$';`;
          return `${iso("meals")}\n${iso("exercises")}\n${iso("weights")}`;
        }
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
  ],
  { table: "macros_migrations" },
);
