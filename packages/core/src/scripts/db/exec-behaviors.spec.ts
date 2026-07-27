import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavior tests for db-exec that complement parameterized.spec.ts (which
 * covers bind-arg plumbing and the security denylists). Here we focus on the
 * statement-shape guards and the agent-facing result semantics — multi-
 * statement rejection, SELECT routing, the zero-changes scoping hint, INSERT
 * ownership injection, and REPLACE scoping — run against a real temp SQLite DB.
 */
describe("db-exec behaviors", () => {
  let dir: string;
  let dbFile: string;
  let url: string;

  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = createClient({ url });
    try {
      return await fn(c);
    } finally {
      c.close();
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "db-exec-"));
    dbFile = path.join(dir, "app.db");
    url = "file:" + dbFile;
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE notes (id TEXT PRIMARY KEY, owner_email TEXT, title TEXT)`,
      );
    });
    vi.stubEnv("AGENT_USER_EMAIL", "owner@x.com");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  async function runExec(extra: string[]): Promise<string[]> {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      });
    try {
      const { default: dbExec } = await import("./exec.js");
      await dbExec(["--db", dbFile, ...extra]);
    } finally {
      spy.mockRestore();
    }
    return logs;
  }

  async function runExecJson(extra: string[]): Promise<any> {
    const logs = await runExec(["--format", "json", ...extra]);
    const joined = logs.join("\n");
    return JSON.parse(joined.slice(joined.indexOf("{")));
  }

  // ── Statement-shape guards ──────────────────────────────────────────────
  it("rejects a SELECT (routes the agent to db-query)", async () => {
    const { default: dbExec } = await import("./exec.js");
    await expect(
      dbExec(["--db", dbFile, "--sql", "SELECT * FROM notes"]),
    ).rejects.toThrow(/use db-query for SELECT/);
  });

  it("rejects two statements packed into one --sql string", async () => {
    const { default: dbExec } = await import("./exec.js");
    await expect(
      dbExec([
        "--db",
        dbFile,
        "--sql",
        "UPDATE notes SET title = 'x'; DELETE FROM notes",
      ]),
    ).rejects.toThrow(/multiple SQL statements/);
  });

  it("does not treat a semicolon inside a string literal as a second statement", async () => {
    await withClient((c) =>
      c.execute({
        sql: `INSERT INTO notes VALUES (?, ?, ?)`,
        args: ["n1", "owner@x.com", "old"],
      }),
    );
    const out = await runExecJson([
      "--sql",
      "UPDATE notes SET title = 'a; b' WHERE id = 'n1'",
    ]);
    expect(out.changes).toBe(1);
    const title = await withClient((c) =>
      c
        .execute(`SELECT title FROM notes WHERE id = 'n1'`)
        .then((r) => (r.rows[0]?.title ?? r.rows[0]?.[0]) as string),
    );
    expect(title).toBe("a; b");
  });

  it("rejects passing both --sql and --statements", async () => {
    const { default: dbExec } = await import("./exec.js");
    await expect(
      dbExec([
        "--db",
        dbFile,
        "--sql",
        "DELETE FROM notes",
        "--statements",
        JSON.stringify([{ sql: "DELETE FROM notes" }]),
      ]),
    ).rejects.toThrow(/either --sql or --statements, not both/i);
  });

  it("rejects DROP / DDL through db-exec", async () => {
    const { default: dbExec } = await import("./exec.js");
    await expect(
      dbExec(["--db", dbFile, "--sql", "DROP TABLE notes"]),
    ).rejects.toThrow(/only INSERT, UPDATE, DELETE, REPLACE/);
  });

  // ── Result semantics ────────────────────────────────────────────────────
  it("emits a per-user scoping hint when an UPDATE changes zero rows", async () => {
    // No matching row → 0 changes. The hint must mention scoping so the agent
    // doesn't report a silent no-op as success.
    const logs = await runExec([
      "--sql",
      "UPDATE notes SET title = 'x' WHERE id = 'missing'",
    ]);
    const text = logs.join("\n");
    expect(text).toContain("Changes: 0");
    expect(text).toMatch(/owned by a different user|per-user.*scoping/i);
  });

  it("qualifies INSERT OR IGNORE to the base table and skips a duplicate (changes=0) instead of erroring on the scoped view", async () => {
    await withClient((c) =>
      c.execute({
        sql: `INSERT INTO notes VALUES (?, ?, ?)`,
        args: ["dup", "owner@x.com", "first"],
      }),
    );
    // The `INSERT OR <conflict>` conflict forms must be qualified to
    // main."notes" (like a bare INSERT INTO) so the write reaches the real
    // table, not the non-updatable scoped temp view. id='dup' already exists,
    // so OR IGNORE skips the row: 0 changes, no error.
    const out = await runExecJson([
      "--sql",
      "INSERT OR IGNORE INTO notes (id, title) VALUES ('dup', 'second')",
    ]);
    expect(out.changes).toBe(0);
    // The pre-existing row is untouched (IGNORE did not overwrite it).
    const title = await withClient((c) =>
      c
        .execute(`SELECT title FROM notes WHERE id = 'dup'`)
        .then((r) => (r.rows[0]?.title ?? r.rows[0]?.[0]) as string),
    );
    expect(title).toBe("first");
  });

  // ── INSERT ownership injection (SQLite) ─────────────────────────────────
  it("auto-injects owner_email on INSERT so the row is visible to the writer", async () => {
    const out = await runExecJson([
      "--sql",
      "INSERT INTO notes (id, title) VALUES (?, ?)",
      "--args",
      JSON.stringify(["n-inject", "hello"]),
    ]);
    expect(out.changes).toBe(1);
    // The base row must carry the current user's owner_email even though the
    // INSERT never named the column.
    const owner = await withClient((c) =>
      c
        .execute(`SELECT owner_email FROM notes WHERE id = 'n-inject'`)
        .then((r) => (r.rows[0]?.owner_email ?? r.rows[0]?.[0]) as string),
    );
    expect(owner).toBe("owner@x.com");
  });

  it("blocks an explicit owner_email in an INSERT column list (access-control column denylist)", async () => {
    // Writing owner_email directly is treated as an access-control write and is
    // refused — the agent can't plant a row under an arbitrary owner.
    const { default: dbExec } = await import("./exec.js");
    await expect(
      dbExec([
        "--db",
        dbFile,
        "--sql",
        "INSERT INTO notes (id, owner_email, title) VALUES ('n-explicit', 'victim@x.com', 't')",
      ]),
    ).rejects.toThrow(/identity\/access-control column "owner_email"/);
  });

  // ── REPLACE scoping ─────────────────────────────────────────────────────
  it("auto-injects owner_email on REPLACE INTO so the row is visible to the writer under scoping", async () => {
    const out = await runExecJson([
      "--sql",
      "REPLACE INTO notes (id, title) VALUES (?, ?)",
      "--args",
      JSON.stringify(["n-replace", "v1"]),
    ]);
    expect(out.changes).toBe(1);
    const owner = await withClient((c) =>
      c
        .execute(`SELECT owner_email FROM notes WHERE id = 'n-replace'`)
        .then(
          (r) => (r.rows[0]?.owner_email ?? r.rows[0]?.[0]) as string | null,
        ),
    );
    // REPLACE creates a new row under the current user, so ownership injection
    // must apply (just like INSERT) — otherwise the row lands unowned and a
    // follow-up scoped read by the same user would not see it.
    expect(owner).toBe("owner@x.com");
  });

  // ── Batch transactional rollback ────────────────────────────────────────
  it("rolls back the whole batch when a later statement fails", async () => {
    await withClient((c) =>
      c.execute({
        sql: `INSERT INTO notes VALUES (?, ?, ?)`,
        args: ["seed", "owner@x.com", "seed-title"],
      }),
    );
    const { default: dbExec } = await import("./exec.js");
    await expect(
      dbExec([
        "--db",
        dbFile,
        "--statements",
        JSON.stringify([
          { sql: "UPDATE notes SET title = 'changed' WHERE id = 'seed'" },
          // Second statement references a non-existent column → fails, forcing
          // a rollback of the first UPDATE.
          { sql: "UPDATE notes SET nonexistent_col = 'x' WHERE id = 'seed'" },
        ]),
      ]),
    ).rejects.toThrow();

    const title = await withClient((c) =>
      c
        .execute(`SELECT title FROM notes WHERE id = 'seed'`)
        .then((r) => (r.rows[0]?.title ?? r.rows[0]?.[0]) as string),
    );
    // The first UPDATE must have been rolled back.
    expect(title).toBe("seed-title");
  });
});
