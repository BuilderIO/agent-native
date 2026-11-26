import { describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import {
  ensureSharesTableColumns,
  sharesTableMigrationSql,
} from "./share-columns.js";

function toDollarParams(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

async function createDb() {
  const pg = await createTestPglite({ reuseEmptyBootstrap: true });
  const exec: DbExec = {
    execute: async (statement) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : statement.args;
      const result = await pg.query(toDollarParams(sql), args);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowsAffected: result.affectedRows ?? 0,
      };
    },
  };
  return { pg, exec };
}

const OLD_SHARES = (name: string) => `CREATE TABLE ${name} (
  id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT ''
)`;

async function columnsOf(
  pg: { query: (sql: string, args: unknown[]) => Promise<{ rows: unknown[] }> },
  table: string,
) {
  const { rows } = await pg.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [table],
  );
  return (rows as { column_name: string }[]).map((r) => r.column_name);
}

describe("ensureSharesTableColumns", () => {
  it("adds notified_at to an app shares table built before the column existed", async () => {
    const { pg, exec } = await createDb();
    await pg.exec(OLD_SHARES("project_shares"));
    await pg.exec(`CREATE TABLE unrelated (id TEXT PRIMARY KEY, role TEXT)`);

    expect(await ensureSharesTableColumns({ injectedClient: exec })).toBe(1);

    expect(await columnsOf(pg, "project_shares")).toContain("notified_at");
    expect(await columnsOf(pg, "unrelated")).not.toContain("notified_at");
    expect(await ensureSharesTableColumns({ injectedClient: exec })).toBe(0);
    await pg.close();
  });

  it("exposes statements an app migration can run", async () => {
    const { pg } = await createDb();
    await pg.exec(OLD_SHARES("artifact_shares"));
    for (const sql of sharesTableMigrationSql("artifact_shares")) {
      await pg.exec(sql);
      await pg.exec(sql);
    }
    expect(await columnsOf(pg, "artifact_shares")).toContain("notified_at");
    expect(() => sharesTableMigrationSql("bad name;")).toThrow();
    await pg.close();
  });
});
