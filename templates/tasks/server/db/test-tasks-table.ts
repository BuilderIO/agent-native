import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "./schema.js";

export const TEST_TASKS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  promoted_to_task BOOLEAN NOT NULL DEFAULT true,
  sort_order DOUBLE PRECISION NOT NULL DEFAULT 0,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_done_updated
  ON tasks (owner_email, done, updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_sort
  ON tasks (owner_email, sort_order);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_promoted_sort
  ON tasks (owner_email, promoted_to_task, sort_order);
CREATE TABLE IF NOT EXISTS custom_fields (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  sort_order DOUBLE PRECISION NOT NULL DEFAULT 0,
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
  ON custom_field_values (owner_email, field_id);
`;

export async function createInMemoryTasksDb() {
  const dir = mkdtempSync(join(tmpdir(), "tasks-test-"));
  const client = await PGlite.create(dir);
  const query = client.query.bind(client);
  Object.defineProperty(client, "query", {
    configurable: true,
    writable: true,
    value: ((sql: string, params?: unknown[], options?: unknown) => {
      const postgresSql = sql.includes('"sort_order" = case')
        ? sql.replace(
            /then \$(\d+)/g,
            (_match, index) => `then $${index}::double precision`,
          )
        : sql;
      return query(postgresSql, params, options as never);
    }) as typeof client.query,
  });
  for (const statement of TEST_TASKS_TABLE_SQL.split(";")
    .map((sql) => sql.trim())
    .filter(Boolean)) {
    await client.query(statement);
  }
  const testDb = drizzle(client, { schema });

  const close = client.close.bind(client);
  client.close = async () => {
    await close();
    rmSync(dir, { recursive: true, force: true });
  };

  return { client, testDb };
}
