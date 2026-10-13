import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createPostgresScriptClient,
  type PostgresScriptClient,
} from "./postgres-client.js";

type Client = PostgresScriptClient;

async function createClient({ url }: { url: string }) {
  const client = await createPostgresScriptClient(url);
  return {
    async execute(input: string | { sql: string; args?: unknown[] }) {
      return client.unsafe(
        typeof input === "string" ? input : input.sql,
        typeof input === "string" ? undefined : input.args,
      );
    },
    close: () => client.end(),
  };
}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("db-check-scoping", () => {
  let dir: string;
  let dbFile: string;
  let prevExitCode: typeof process.exitCode;

  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = await createClient({ url: "pglite:" + dbFile });
    try {
      return await fn(c);
    } finally {
      c.close();
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "db-check-"));
    dbFile = path.join(dir, "app");
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

    expect(process.exitCode).toBeUndefined();

    const logs = await runCheck([]);
    expect(logs.join("\n")).toContain("Tables denied to raw database tools:");
    expect(process.exitCode).toBe(1);
  });

  it("skips core/framework tables that scope themselves", async () => {
    await withClient(async (c) => {
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
      "All application tables have proper scoping columns.",
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
