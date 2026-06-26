import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * db-schema introspects the database and prints its structure for the agent.
 * Two things matter most here:
 *   1. The DATABASE label must REDACT credentials (passwords) — it's printed
 *      to logs/tool output the agent can echo back.
 *   2. The SQLite introspection (columns, types, PK/NOT NULL/DEFAULT, FKs,
 *      indexes) must be faithful in both JSON and human-readable form.
 * The functions aren't exported, so we drive the real default export against a
 * temp-file SQLite database and capture stdout.
 */
describe("db-schema", () => {
  let dir: string;
  let dbFile: string;

  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = createClient({ url: "file:" + dbFile });
    try {
      return await fn(c);
    } finally {
      c.close();
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "db-schema-"));
    dbFile = path.join(dir, "app.db");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  async function runSchema(extra: string[]): Promise<string[]> {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      });
    try {
      const { default: dbSchema } = await import("./schema.js");
      await dbSchema(extra);
    } finally {
      spy.mockRestore();
    }
    return logs;
  }

  async function runSchemaJson(extra: string[]): Promise<any> {
    const logs = await runSchema([
      "--db",
      dbFile,
      "--format",
      "json",
      ...extra,
    ]);
    const joined = logs.join("\n");
    const start = joined.indexOf("{");
    return JSON.parse(joined.slice(start));
  }

  it("introspects columns, PK, NOT NULL, DEFAULT, FKs, and indexes (JSON)", async () => {
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE authors (id TEXT PRIMARY KEY, name TEXT NOT NULL, bio TEXT DEFAULT 'none')`,
      );
      await c.execute(
        `CREATE TABLE posts (
           id TEXT PRIMARY KEY,
           author_id TEXT NOT NULL REFERENCES authors(id),
           title TEXT
         )`,
      );
      await c.execute(`CREATE UNIQUE INDEX idx_posts_title ON posts(title)`);
    });

    const out = await runSchemaJson([]);

    const tables = Object.fromEntries(out.tables.map((t: any) => [t.name, t]));
    expect(Object.keys(tables).sort()).toEqual(["authors", "posts"]);

    const authors = tables.authors;
    const cols = Object.fromEntries(
      authors.columns.map((c: any) => [c.name, c]),
    );
    expect(cols.id.pk).toBe(true);
    expect(cols.name.notnull).toBe(true);
    expect(cols.name.pk).toBe(false);
    // SQLite stores a DEFAULT 'none' literal with quotes — just assert it's set.
    expect(cols.bio.dflt_value).not.toBeNull();

    const posts = tables.posts;
    expect(posts.foreignKeys).toHaveLength(1);
    expect(posts.foreignKeys[0]).toMatchObject({
      from: "author_id",
      table: "authors",
      to: "id",
    });

    const titleIdx = posts.indexes.find((i: any) =>
      i.name.includes("idx_posts_title"),
    );
    expect(titleIdx).toBeDefined();
    expect(titleIdx.unique).toBe(true);
    expect(titleIdx.columns).toEqual(["title"]);
  });

  it("excludes sqlite_* internal tables from introspection", async () => {
    await withClient(async (c) => {
      // An AUTOINCREMENT table makes SQLite create sqlite_sequence.
      await c.execute(
        `CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)`,
      );
      await c.execute(`INSERT INTO t (v) VALUES ('x')`);
    });
    const out = await runSchemaJson([]);
    const names = out.tables.map((t: any) => t.name);
    expect(names).toContain("t");
    expect(names.some((n: string) => n.startsWith("sqlite_"))).toBe(false);
  });

  it("emits human-readable output with annotations when no --format is given", async () => {
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE widgets (id TEXT PRIMARY KEY, label TEXT NOT NULL)`,
      );
    });
    const logs = await runSchema(["--db", dbFile]);
    const text = logs.join("\n");
    expect(text).toContain("Table: widgets");
    expect(text).toContain("PRIMARY KEY");
    expect(text).toContain("NOT NULL");
    // JSON braces must NOT appear in human-readable mode.
    expect(text).not.toMatch(/^\s*\{/m);
  });

  it("labels a file: database as the bare filesystem path (no auth section to redact)", async () => {
    await withClient(async (c) => {
      await c.execute(`CREATE TABLE t (id TEXT PRIMARY KEY)`);
    });
    // The label of the local file DB is the plain filesystem path — the
    // "file:" prefix is stripped and there is nothing to redact. The real
    // redaction behavior is asserted by the Postgres test below.
    const out = await runSchemaJson([]);
    expect(out.database).toBe(dbFile);
    expect(out.database.startsWith("file:")).toBe(false);
  });

  it("prints help and does not touch the database", async () => {
    const logs = await runSchema(["--help"]);
    expect(logs.join("\n")).toContain("Usage: pnpm action db-schema");
  });

  it("redacts the Postgres password in the database label (never leaks the secret to tool output)", async () => {
    // Resolve to a Postgres URL via the env path (not --db, which forces file:).
    vi.doMock("../../db/client.js", () => ({
      getDatabaseUrl: () =>
        "postgres://app_user:sup3r-secret@db.example.com:5432/appdb",
    }));
    // Mock the postgres driver so no real connection is attempted. The driver
    // is a tagged-template function; return the table list for the tables
    // query and empty arrays for the per-table column/pk/fk/index queries.
    vi.doMock("postgres", () => ({
      default: () =>
        Object.assign(
          async (strings: TemplateStringsArray) => {
            const text = strings.join(" ");
            if (text.includes("information_schema.tables")) {
              return [{ name: "notes" }];
            }
            return [];
          },
          { end: vi.fn() },
        ),
    }));

    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      });
    try {
      const { default: dbSchema } = await import("./schema.js");
      await dbSchema(["--format", "json"]);
    } finally {
      spy.mockRestore();
    }
    const joined = logs.join("\n");
    const out = JSON.parse(joined.slice(joined.indexOf("{")));

    expect(out.database).toContain("app_user:***@db.example.com");
    expect(out.database).not.toContain("sup3r-secret");
  });
});
