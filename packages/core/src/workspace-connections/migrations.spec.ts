import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    createDbExec: vi.fn(),
    getDbExec: vi.fn(),
    getMigrationDatabaseUrl: vi.fn(() => ""),
  };
});

import { createTestPglite } from "../a2a/test-pglite.js";
import {
  createDbExec,
  getDbExec,
  getMigrationDatabaseUrl,
  type DbExec,
} from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import {
  WORKSPACE_CONNECTIONS_MIGRATIONS,
  WORKSPACE_CONNECTIONS_MIGRATIONS_TABLE,
} from "./migrations.js";

function read(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    "utf8",
  );
}

function migrationSql(): string {
  return WORKSPACE_CONNECTIONS_MIGRATIONS.map((entry) =>
    typeof entry.sql === "string" ? entry.sql : (entry.sql.postgres ?? ""),
  ).join("\n");
}

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function pgliteExec(
  pglite: Awaited<ReturnType<typeof createTestPglite>>,
): DbExec {
  return {
    async execute(statement) {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : (statement.args ?? []);
      const result = await pglite.query(postgresSql(sql), args);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    async close() {},
  };
}

describe("WORKSPACE_CONNECTIONS_MIGRATIONS", () => {
  it("creates every table the runtime ensure path only creates outside production", () => {
    const ensured = [
      ...read("./store.ts").matchAll(/ensureTableExists\(\s*"([a-z_]+)"/g),
      ...read("./groups.ts").matchAll(/ensureTableExists\(\s*"([a-z_]+)"/g),
    ].map((match) => match[1]);

    expect(ensured.length).toBeGreaterThan(0);
    const sql = migrationSql();
    for (const table of ensured) {
      expect(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`).test(sql),
        `${table} is ensured at runtime but has no release migration`,
      ).toBe(true);
    }
  });

  it("is wired into the framework release step", () => {
    const release = read("../server/release-migrations.ts");
    expect(release).toMatch(
      /runMigrations\(WORKSPACE_CONNECTIONS_MIGRATIONS,\s*\{\s*table:\s*WORKSPACE_CONNECTIONS_MIGRATIONS_TABLE/,
    );
    expect(WORKSPACE_CONNECTIONS_MIGRATIONS_TABLE).toBe(
      "_workspace_connections_migrations",
    );
  });

  it("stores epoch-millisecond columns as BIGINT on Postgres", () => {
    for (const entry of WORKSPACE_CONNECTIONS_MIGRATIONS) {
      if (typeof entry.sql === "string") continue;
      const pg = entry.sql.postgres ?? "";
      if (!pg.includes("CREATE TABLE")) continue;
      expect(pg).not.toMatch(/(created_at|updated_at|last_used_at)\s+INTEGER/);
    }
  });

  it("backfills normalized group names and enforces new writes uniquely", () => {
    const sql = migrationSql();
    const v11 = WORKSPACE_CONNECTIONS_MIGRATIONS.find(
      (entry) => entry.version === 11,
    );
    const v11Sql =
      typeof v11?.sql === "string" ? v11.sql : (v11?.sql.postgres ?? "");
    expect(sql).toMatch(
      /ALTER TABLE workspace_user_groups\s+ADD COLUMN IF NOT EXISTS normalized_name TEXT/i,
    );
    expect(sql).toMatch(
      /SET normalized_name = LOWER\(BTRIM\(group_row\.name\)\)/i,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_user_groups_org_normalized_name[\s\S]*WHERE normalized_name IS NOT NULL/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.workspace_user_groups_set_normalized_name/i,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_workspace_user_groups_normalized_name[\s\S]*BEFORE INSERT OR UPDATE OF name ON public\.workspace_user_groups/i,
    );
    expect(v11Sql.indexOf("CREATE OR REPLACE FUNCTION")).toBeLessThan(
      v11Sql.indexOf("CREATE UNIQUE INDEX"),
    );
    expect(v11Sql.indexOf("CREATE UNIQUE INDEX")).toBeLessThan(
      v11Sql.indexOf("UPDATE workspace_user_groups"),
    );
    for (const version of [11, 12, 13]) {
      const migration = WORKSPACE_CONNECTIONS_MIGRATIONS.find(
        (entry) => entry.version === version,
      );
      const migrationSql =
        typeof migration?.sql === "string"
          ? migration.sql
          : (migration?.sql.postgres ?? "");
      expect(migrationSql).toMatch(/EXCEPTION WHEN duplicate_object/i);
    }
    expect(read("./groups.ts")).not.toMatch(
      /backfillWorkspaceUserGroupNameKeys|SET normalized_name = LOWER\(BTRIM\(/i,
    );
  });

  it("installs the normalized-name trigger before older writers can bypass it", async () => {
    const pglite = await createTestPglite();
    try {
      for (const migration of WORKSPACE_CONNECTIONS_MIGRATIONS) {
        if (migration.version > 10) break;
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        if (sql) await pglite.exec(sql);
      }
      await pglite
        .prepare(
          "INSERT INTO workspace_user_groups (id, org_id, name) VALUES (?, ?, ?)",
        )
        .run("legacy-group", "org-trigger", "Finance");

      for (const migration of WORKSPACE_CONNECTIONS_MIGRATIONS) {
        if (migration.version !== 11) continue;
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        if (sql) await pglite.exec(sql);
      }

      await expect(
        pglite
          .prepare(
            "INSERT INTO workspace_user_groups (id, org_id, name) VALUES (?, ?, ?)",
          )
          .run("legacy-writer", "org-trigger", "finance"),
      ).rejects.toThrow(/duplicate|unique/i);

      for (const migration of WORKSPACE_CONNECTIONS_MIGRATIONS) {
        if (migration.version !== 12) continue;
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        if (sql) await pglite.exec(sql);
      }

      const v13 = WORKSPACE_CONNECTIONS_MIGRATIONS.find(
        (entry) => entry.version === 13,
      );
      const v13Sql =
        typeof v13?.sql === "string" ? v13.sql : (v13?.sql.postgres ?? "");
      await pglite.exec(v13Sql);

      const row = await pglite
        .prepare(
          "SELECT normalized_name FROM workspace_user_groups WHERE id = ?",
        )
        .get("legacy-group");
      expect(row?.normalized_name).toBe("finance");
    } finally {
      await pglite.close();
    }
  }, 30_000);

  it("repairs normalized keys left by pre-trigger release migrations", async () => {
    const pglite = await createTestPglite();
    const exec = pgliteExec(pglite);
    try {
      for (const migration of WORKSPACE_CONNECTIONS_MIGRATIONS) {
        if (migration.version > 10) break;
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        if (sql) await pglite.exec(sql);
      }
      await pglite
        .prepare(
          "INSERT INTO workspace_user_groups (id, org_id, name) VALUES (?, ?, ?)",
        )
        .run("legacy-group", "org-repair", "Finance");
      await pglite.exec(`
        UPDATE workspace_user_groups
        SET normalized_name = LOWER(BTRIM(name))
        WHERE id = 'legacy-group';
        CREATE UNIQUE INDEX idx_workspace_user_groups_org_normalized_name
          ON workspace_user_groups (org_id, normalized_name)
          WHERE normalized_name IS NOT NULL;
      `);
      await pglite
        .prepare(
          "INSERT INTO workspace_user_groups (id, org_id, name) VALUES (?, ?, ?)",
        )
        .run("legacy-gap-group", "org-repair", "Finance Team");

      await pglite.exec(
        `CREATE OR REPLACE FUNCTION public.workspace_user_groups_set_normalized_name()
          RETURNS trigger
          LANGUAGE plpgsql
          AS 'BEGIN
            NEW.normalized_name := LOWER(BTRIM(NEW.name));
            RETURN NEW;
          END;';
          CREATE TRIGGER trg_workspace_user_groups_normalized_name
            BEFORE INSERT OR UPDATE OF name ON public.workspace_user_groups
            FOR EACH ROW
            EXECUTE FUNCTION public.workspace_user_groups_set_normalized_name();`,
      );
      await pglite.exec(
        `CREATE TABLE workspace_group_runner_migrations (version BIGINT PRIMARY KEY);
         INSERT INTO workspace_group_runner_migrations (version) VALUES (13);`,
      );
      vi.mocked(getDbExec).mockReturnValue(exec);
      vi.mocked(createDbExec).mockResolvedValue(exec);
      vi.mocked(getMigrationDatabaseUrl).mockReturnValue("");

      await runMigrations(WORKSPACE_CONNECTIONS_MIGRATIONS, {
        table: "workspace_group_runner_migrations",
      })(null);

      const repaired = await pglite
        .prepare(
          "SELECT normalized_name FROM workspace_user_groups WHERE id = ?",
        )
        .get("legacy-gap-group");
      expect(repaired?.normalized_name).toBe("finance team");
      await expect(
        pglite
          .prepare(
            "INSERT INTO workspace_user_groups (id, org_id, name) VALUES (?, ?, ?)",
          )
          .run("legacy-gap-duplicate", "org-repair", "finance team"),
      ).rejects.toThrow(/duplicate|unique/i);
      const version = await pglite
        .prepare(
          "SELECT MAX(version) AS version FROM workspace_group_runner_migrations",
        )
        .get();
      expect(version?.version).toBe(14);
    } finally {
      vi.clearAllMocks();
      await pglite.close();
    }
  }, 30_000);

  it("has unique ascending versions", () => {
    const versions = WORKSPACE_CONNECTIONS_MIGRATIONS.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });
});
