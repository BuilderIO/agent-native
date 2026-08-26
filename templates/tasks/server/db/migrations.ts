import { runMigrations } from "@agent-native/core/db";
import { loadDrizzleMigrations } from "@agent-native/core/db/drizzle-migrations";

// The checked-in Drizzle metadata baseline represents this legacy schema, so
// future `db:generate` runs produce deltas instead of recreating these tables.
// Keep historical entries unnamed for legacy-ledger compatibility; every new
// migration must add a stable, unique `name` slug.
const legacyTasksMigrations = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
  },
  {
    version: 2,
    sql: `CREATE INDEX IF NOT EXISTS idx_tasks_owner_done_updated
        ON tasks (owner_email, done, updated_at)`,
  },
  {
    version: 3,
    sql: `ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
  },
  {
    version: 4,
    sql: `CREATE INDEX IF NOT EXISTS idx_tasks_owner_sort
        ON tasks (owner_email, sort_order)`,
  },
  {
    version: 5,
    sql: `WITH ranked AS (
        SELECT id,
          (ROW_NUMBER() OVER (
            PARTITION BY owner_email
            ORDER BY updated_at DESC, created_at DESC
          ) - 1) * 1000 AS next_sort
        FROM tasks
      )
      UPDATE tasks
      SET sort_order = (SELECT next_sort FROM ranked WHERE ranked.id = tasks.id)
      WHERE EXISTS (SELECT 1 FROM ranked WHERE ranked.id = tasks.id)`,
  },
  {
    version: 6,
    sql: `ALTER TABLE tasks ADD COLUMN promoted_to_task INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_tasks_owner_promoted_sort
        ON tasks (owner_email, promoted_to_task, sort_order)`,
  },
  {
    version: 7,
    sql: `CREATE TABLE IF NOT EXISTS custom_fields (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        config_json TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        owner_email TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_custom_fields_owner_sort
        ON custom_fields (owner_email, sort_order);
      CREATE TABLE IF NOT EXISTS custom_field_values (
        id TEXT PRIMARY KEY,
        field_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        value_json TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_field_values_unique_task_field
        ON custom_field_values (owner_email, task_id, field_id);
      CREATE INDEX IF NOT EXISTS idx_custom_field_values_owner_task
        ON custom_field_values (owner_email, task_id);
      CREATE INDEX IF NOT EXISTS idx_custom_field_values_owner_field
        ON custom_field_values (owner_email, field_id)`,
  },
  // v8: the portable boolean helpers map to BOOLEAN on Postgres, while the
  // historical INTEGER columns above were adapted to BIGINT. Preserve 0/1
  // values while aligning the live Postgres schema with Drizzle's baseline.
  // SQLite keeps its INTEGER boolean representation and records this
  // dialect-gated entry without running SQL.
  {
    version: 8,
    sql: {
      postgres: `ALTER TABLE tasks ALTER COLUMN done DROP DEFAULT;
ALTER TABLE tasks ALTER COLUMN done TYPE boolean USING (LOWER(done::text) IN ('1', 'true', 't', 'yes'));
ALTER TABLE tasks ALTER COLUMN done SET DEFAULT false;
ALTER TABLE tasks ALTER COLUMN promoted_to_task DROP DEFAULT;
ALTER TABLE tasks ALTER COLUMN promoted_to_task TYPE boolean USING (LOWER(promoted_to_task::text) IN ('1', 'true', 't', 'yes'));
ALTER TABLE tasks ALTER COLUMN promoted_to_task SET DEFAULT true`,
    },
  },
];

export const runTasksMigrations = runMigrations(
  async () => [
    ...legacyTasksMigrations,
    ...(await loadDrizzleMigrations(new URL("./migrations", import.meta.url), {
      dialect: "postgresql",
    })),
  ],
  { table: "tasks_migrations" },
);
