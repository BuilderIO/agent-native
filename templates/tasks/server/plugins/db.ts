import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
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
    {
      version: 8,
      sql: `CREATE TABLE IF NOT EXISTS user_config (
        owner_email TEXT PRIMARY KEY,
        task_card_field_ids_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    },
  ],
  { table: "tasks_migrations" },
);
