import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
/**
 * End-to-end isolation test for the agent's raw-SQL tools against a REAL
 * (temp-file) SQLite database with two tenants. This is the regression proof
 * for the schema-qualified scope-bypass fix (safety.ts) and the credential-row
 * exclusion (scoping.ts): it runs the actual exported db-query / db-exec entry
 * points — no mocks of the SQL layer — and asserts true row-level isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("db tools cross-tenant isolation (e2e, real sqlite)", () => {
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
    dir = await mkdtemp(path.join(os.tmpdir(), "an-scope-"));
    dbFile = path.join(dir, "app.db");
    url = "file:" + dbFile;
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE notes (id TEXT PRIMARY KEY, owner_email TEXT, body TEXT)`,
      );
      await c.execute(
        `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
      );
      await c.execute({
        sql: `INSERT INTO notes VALUES (?, ?, ?)`,
        args: ["n1", "a@x.com", "A-secret"],
      });
      await c.execute({
        sql: `INSERT INTO notes VALUES (?, ?, ?)`,
        args: ["n2", "b@x.com", "B-secret"],
      });
      await c.execute({
        sql: `INSERT INTO settings VALUES (?, ?, ?)`,
        args: [
          "u:a@x.com:credential:OPENAI_API_KEY",
          JSON.stringify({ value: "sk-AAA-secret" }),
          1,
        ],
      });
      await c.execute({
        sql: `INSERT INTO settings VALUES (?, ?, ?)`,
        args: ["u:a@x.com:pref:theme", JSON.stringify({ value: "dark" }), 1],
      });
    });
    vi.stubEnv("AGENT_USER_EMAIL", "a@x.com");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  async function runQuery(sql: string): Promise<any> {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      });
    try {
      const { default: dbQuery } = await import("./query.js");
      await dbQuery(["--sql", sql, "--db", dbFile, "--format", "json"]);
    } finally {
      spy.mockRestore();
    }
    const jsonLine = logs.find((l) => l.trim().startsWith("{"));
    return jsonLine ? JSON.parse(jsonLine) : { rows: [] };
  }

  async function runExec(sql: string): Promise<void> {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { default: dbExec } = await import("./exec.js");
      await dbExec(["--sql", sql, "--db", dbFile]);
    } finally {
      spy.mockRestore();
    }
  }

  // ── Reads ──────────────────────────────────────────────────────────────
  it("rejects a schema-qualified read (the scope bypass)", async () => {
    const { default: dbQuery } = await import("./query.js");
    await expect(
      dbQuery(["--sql", "SELECT * FROM main.notes", "--db", dbFile]),
    ).rejects.toThrow(/schema-qualified/i);
  });

  it("scopes a normal SELECT to the current tenant only", async () => {
    const res = await runQuery("SELECT id, body FROM notes ORDER BY id");
    const bodies = res.rows.map((r: any) => r.body);
    expect(bodies).toContain("A-secret");
    expect(bodies).not.toContain("B-secret");
  });

  it("hides credential rows from the settings view, keeps other prefs", async () => {
    const res = await runQuery("SELECT key FROM settings");
    const keys = res.rows.map((r: any) => r.key);
    expect(keys).toContain("u:a@x.com:pref:theme");
    expect(keys.some((k: string) => k.includes(":credential:"))).toBe(false);
  });

  // ── Writes ─────────────────────────────────────────────────────────────
  it("rejects a schema-qualified write", async () => {
    const { default: dbExec } = await import("./exec.js");
    await expect(
      dbExec([
        "--sql",
        "UPDATE main.notes SET body = 'hacked'",
        "--db",
        dbFile,
      ]),
    ).rejects.toThrow(/schema-qualified/i);
    // The other tenant's row is untouched.
    const rows = await withClient((c) =>
      c
        .execute(`SELECT body FROM notes WHERE owner_email = 'b@x.com'`)
        .then((r) => r.rows),
    );
    expect(rows[0].body).toBe("B-secret");
  });

  it("scopes a normal DELETE to the current tenant (no cross-tenant wipe)", async () => {
    await runExec("DELETE FROM notes");
    const remaining = await withClient((c) =>
      c
        .execute(`SELECT owner_email, body FROM notes`)
        .then((r) => r.rows as any[]),
    );
    // Only tenant A's row was deleted; tenant B's survives.
    expect(remaining).toHaveLength(1);
    expect(remaining[0].owner_email).toBe("b@x.com");
  });

  it("scopes a normal UPDATE to the current tenant", async () => {
    await runExec("UPDATE notes SET body = 'edited'");
    const rows = await withClient((c) =>
      c
        .execute(`SELECT owner_email, body FROM notes ORDER BY owner_email`)
        .then((r) => r.rows as any[]),
    );
    const byOwner = Object.fromEntries(
      rows.map((r) => [r.owner_email, r.body]),
    );
    expect(byOwner["a@x.com"]).toBe("edited");
    expect(byOwner["b@x.com"]).toBe("B-secret"); // untouched
  });
});
