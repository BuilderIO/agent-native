import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * db-check-scoping is the CI/agent guard that flags template tables missing the
 * owner_email (and optionally org_id) scoping columns. Those unscoped tables
 * are denied to the raw db-* tools, so the detection logic here is what keeps
 * a forgotten ownership column from becoming a cross-tenant hole. The `validate`
 * helper isn't exported, so we drive the real default export against a temp-file
 * SQLite database and assert on the JSON output and the process exit code.
 */
describe("db-check-scoping", () => {
  let dir: string;
  let dbFile: string;
  let prevExitCode: typeof process.exitCode;

  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = createClient({ url: "file:" + dbFile });
    try {
      return await fn(c);
    } finally {
      c.close();
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "db-check-"));
    dbFile = path.join(dir, "app.db");
    prevExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.exitCode = prevExitCode;
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  async function runCheck(extra: string[]): Promise<string[]> {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      });
    try {
      const { default: dbCheckScoping } = await import("./check-scoping.js");
      await dbCheckScoping(["--db", dbFile, ...extra]);
    } finally {
      spy.mockRestore();
    }
    return logs;
  }

  async function runCheckJson(extra: string[]): Promise<any> {
    const logs = await runCheck(["--format", "json", ...extra]);
    const joined = logs.join("\n");
    return JSON.parse(joined.slice(joined.indexOf("{")));
  }

  it("flags a template table missing owner_email and sets a non-zero exit code", async () => {
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE scoped_notes (id TEXT PRIMARY KEY, owner_email TEXT, body TEXT)`,
      );
      await c.execute(
        `CREATE TABLE leaky_table (id TEXT PRIMARY KEY, body TEXT)`,
      );
    });

    const out = await runCheckJson([]);
    const byTable = Object.fromEntries(
      out.tables.map((t: any) => [t.table, t]),
    );

    expect(byTable.scoped_notes.hasOwnerEmail).toBe(true);
    expect(byTable.scoped_notes.issues).toEqual([]);

    expect(byTable.leaky_table.hasOwnerEmail).toBe(false);
    expect(byTable.leaky_table.issues[0]).toMatch(/missing owner_email/);

    // JSON mode is a pure report and does not set the exit code.
    expect(process.exitCode).toBeUndefined();

    // The human-readable path fails closed: a missing scoping column must
    // surface as exit code 1 (so CI guards catch it).
    const logs = await runCheck([]);
    expect(logs.join("\n")).toContain("Tables denied to raw DB tools:");
    expect(process.exitCode).toBe(1);
  });

  it("skips core/framework tables that scope themselves", async () => {
    await withClient(async (c) => {
      // settings + sessions + chat_threads are in CORE_TABLES and intentionally
      // lack owner_email; they must NOT be reported as issues.
      await c.execute(
        `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`,
      );
      await c.execute(
        `CREATE TABLE sessions (token TEXT PRIMARY KEY, email TEXT)`,
      );
      await c.execute(
        `CREATE TABLE chat_threads (id TEXT PRIMARY KEY, title TEXT)`,
      );
    });

    const out = await runCheckJson([]);
    expect(out.tables).toEqual([]);
    expect(process.exitCode).not.toBe(1);
  });

  it("skips migration helper tables whose name starts with an underscore", async () => {
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE _custom_migrations (id INTEGER PRIMARY KEY, name TEXT)`,
      );
      await c.execute(
        `CREATE TABLE good (id TEXT PRIMARY KEY, owner_email TEXT)`,
      );
    });
    const out = await runCheckJson([]);
    const names = out.tables.map((t: any) => t.table);
    expect(names).toContain("good");
    expect(names).not.toContain("_custom_migrations");
  });

  it("passes when every template table is properly scoped", async () => {
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE notes (id TEXT PRIMARY KEY, owner_email TEXT, body TEXT)`,
      );
    });
    const logs = await runCheck([]);
    expect(logs.join("\n")).toContain(
      "All template tables have proper scoping columns.",
    );
    expect(process.exitCode).not.toBe(1);
  });

  it("with --require-org, a table with owner_email but no org_id is flagged", async () => {
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE personal_only (id TEXT PRIMARY KEY, owner_email TEXT)`,
      );
      await c.execute(
        `CREATE TABLE multi_org (id TEXT PRIMARY KEY, owner_email TEXT, org_id TEXT)`,
      );
    });

    const out = await runCheckJson(["--require-org"]);
    const byTable = Object.fromEntries(
      out.tables.map((t: any) => [t.table, t]),
    );

    expect(byTable.personal_only.hasOrgId).toBe(false);
    expect(byTable.personal_only.issues).toEqual([
      expect.stringMatching(/missing org_id/),
    ]);

    expect(byTable.multi_org.hasOrgId).toBe(true);
    expect(byTable.multi_org.issues).toEqual([]);

    // Human-readable run with --require-org must fail closed on the org gap.
    const logs = await runCheck(["--require-org"]);
    expect(logs.join("\n")).toContain("missing org_id");
    expect(process.exitCode).toBe(1);
  });

  it("without --require-org, a table missing org_id is not flagged", async () => {
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE personal_only (id TEXT PRIMARY KEY, owner_email TEXT)`,
      );
    });
    const out = await runCheckJson([]);
    const byTable = Object.fromEntries(
      out.tables.map((t: any) => [t.table, t]),
    );
    expect(byTable.personal_only.issues).toEqual([]);
    expect(process.exitCode).not.toBe(1);
  });

  it("prints help without inspecting the database", async () => {
    const logs = await runCheck(["--help"]);
    expect(logs.join("\n")).toContain("Usage: pnpm action db-check-scoping");
  });
});
