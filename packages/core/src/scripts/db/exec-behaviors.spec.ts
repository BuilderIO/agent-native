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

describe("db-exec behaviors", () => {
  let dir: string;
  let dbFile: string;
  let url: string;

  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = await createClient({ url });
    try {
      return await fn(c);
    } finally {
      c.close();
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "db-exec-"));
    dbFile = path.join(dir, "app");
    url = "pglite:" + dbFile;
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

  it("rejects a SELECT (routes the agent to db-query)", async () => {
    const { default: dbExec } = await import("./exec.js");
    await expect(
      dbExec(["--db", dbFile, "--sql", "SELECT * FROM notes"]),
    ).rejects.toThrow(/use db-query for read statements/);
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
        .then((r) => (r[0]?.title ?? r[0]?.[0]) as string),
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
    ).rejects.toThrow(/only INSERT, UPDATE, DELETE statements/);
  });

  it("emits a per-user scoping hint when an UPDATE changes zero rows", async () => {
    const logs = await runExec([
      "--sql",
      "UPDATE notes SET title = 'x' WHERE id = 'missing'",
    ]);
    const text = logs.join("\n");
    expect(text).toContain("Changes: 0");
    expect(text).toMatch(/outside the current user's scope/i);
  });

  it("auto-injects owner_email on INSERT so the row is visible to the writer", async () => {
    const out = await runExecJson([
      "--sql",
      "INSERT INTO notes (id, title) VALUES (?, ?)",
      "--args",
      JSON.stringify(["n-inject", "hello"]),
    ]);
    expect(out.changes).toBe(1);
    const owner = await withClient((c) =>
      c
        .execute(`SELECT owner_email FROM notes WHERE id = 'n-inject'`)
        .then((r) => (r[0]?.owner_email ?? r[0]?.[0]) as string),
    );
    expect(owner).toBe("owner@x.com");
  });

  it("blocks an explicit owner_email in an INSERT column list (access-control column denylist)", async () => {
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

  it("auto-injects owner_email on INSERT ... ON CONFLICT so the row is visible to the writer under scoping", async () => {
    const out = await runExecJson([
      "--sql",
      "INSERT INTO notes (id, title) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title",
      "--args",
      JSON.stringify(["n-replace", "v1"]),
    ]);
    expect(out.changes).toBe(1);
    const owner = await withClient((c) =>
      c
        .execute(`SELECT owner_email FROM notes WHERE id = 'n-replace'`)
        .then((r) => (r[0]?.owner_email ?? r[0]?.[0]) as string | null),
    );
    expect(owner).toBe("owner@x.com");
  });

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
          { sql: "UPDATE notes SET nonexistent_col = 'x' WHERE id = 'seed'" },
        ]),
      ]),
    ).rejects.toThrow();

    const title = await withClient((c) =>
      c
        .execute(`SELECT title FROM notes WHERE id = 'seed'`)
        .then((r) => (r[0]?.title ?? r[0]?.[0]) as string),
    );
    expect(title).toBe("seed-title");
  });
});
