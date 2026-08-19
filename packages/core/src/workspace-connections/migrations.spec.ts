import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
    typeof entry.sql === "string"
      ? entry.sql
      : `${entry.sql.postgres ?? ""}\n${entry.sql.sqlite ?? ""}`,
  ).join("\n");
}

describe("WORKSPACE_CONNECTIONS_MIGRATIONS", () => {
  it("creates every table the runtime ensure path only creates outside production", () => {
    // `schemaEnsureDisabled()` short-circuits every probe to "present" on a
    // production serverless runtime, so an `ensureTableExists` call issues no
    // DDL there. A table that lives only in the ensure path is therefore absent
    // in production forever — `workspace_user_groups` shipped that way and
    // started throwing `relation ... does not exist` the next day.
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
    // int4 overflows on a millisecond timestamp.
    for (const entry of WORKSPACE_CONNECTIONS_MIGRATIONS) {
      if (typeof entry.sql === "string") continue;
      const pg = entry.sql.postgres ?? "";
      if (!pg.includes("CREATE TABLE")) continue;
      expect(pg).not.toMatch(/(created_at|updated_at|last_used_at)\s+INTEGER/);
    }
  });

  it("has unique ascending versions", () => {
    const versions = WORKSPACE_CONNECTIONS_MIGRATIONS.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });
});
