import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPostgresScriptClient } from "./postgres-client.js";

// Two synthetic tenants in a local PGlite database. Each case runs a raw-DB
// tool as tenant A, checks the refusal, then checks tenant B's row is
// unchanged and never reached A's output.

const B_SECRET = "B-secret";

describe("agent SQL guards keep each tenant to its own rows (e2e, PGlite)", () => {
  let dir: string;
  let dbFile: string;
  let url: string;

  async function admin<T = Record<string, unknown>>(
    sql: string,
    args?: unknown[],
  ): Promise<T[]> {
    const client = await createPostgresScriptClient(url);
    try {
      return Array.from(await client.unsafe(sql, args)) as T[];
    } finally {
      await client.end();
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "an-sql-guards-"));
    dbFile = path.join(dir, "app");
    url = `pglite:${dbFile}`;
    const setup = [
      `CREATE TABLE notes (id TEXT PRIMARY KEY, owner_email TEXT, body TEXT)`,
      `INSERT INTO notes VALUES ('a1', 'a@x.com', 'A-one'), ('a2', 'a@x.com', 'A-two'), ('b1', 'b@x.com', '${B_SECRET}')`,
      `CREATE MATERIALIZED VIEW notes_mv AS SELECT * FROM notes`,
      `CREATE SCHEMA archive`,
      `CREATE TABLE archive.notes AS SELECT * FROM public.notes`,
      `CREATE FUNCTION leak_sql(t text) RETURNS text LANGUAGE sql AS $$ SELECT string_agg(body, ',') FROM public.notes $$`,
      `CREATE FUNCTION leak_plpgsql() RETURNS text LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT string_agg(body, ',') FROM public.notes); END $$`,
      `CREATE FUNCTION leak_attr(anyelement) RETURNS text LANGUAGE sql AS $$ SELECT string_agg(body, ',') FROM public.notes $$`,
      `CREATE FUNCTION leak_op(text, text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM public.notes WHERE body = $2) $$`,
      `CREATE OPERATOR ==== (LEFTARG = text, RIGHTARG = text, FUNCTION = leak_op)`,
    ];
    for (const sql of setup) await admin(sql);
    vi.stubEnv("AGENT_USER_EMAIL", "a@x.com");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  async function captured(run: () => Promise<void>): Promise<string> {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      });
    try {
      await run();
    } finally {
      spy.mockRestore();
    }
    return logs.join("\n");
  }

  async function dbQuery(sql: string, extra: string[] = []): Promise<string> {
    const { default: run } = await import("./query.js");
    return captured(() =>
      run(["--sql", sql, "--db", dbFile, "--format", "json", ...extra]),
    );
  }

  async function dbExec(args: string[]): Promise<string> {
    const { default: run } = await import("./exec.js");
    return captured(() => run([...args, "--db", dbFile]));
  }

  async function dbPatch(where: string): Promise<string> {
    const { default: run } = await import("./patch.js");
    return captured(() =>
      run([
        "--table",
        "notes",
        "--column",
        "body",
        "--where",
        where,
        "--find",
        "A",
        "--replace",
        "Z",
        "--db",
        dbFile,
      ]),
    );
  }

  async function expectTenantsUnchanged(): Promise<void> {
    const rows = await admin<{ id: string; owner_email: string; body: string }>(
      `SELECT id, owner_email, body FROM public.notes ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: "a1", owner_email: "a@x.com", body: "A-one" },
      { id: "a2", owner_email: "a@x.com", body: "A-two" },
      { id: "b1", owner_email: "b@x.com", body: B_SECRET },
    ]);
  }

  async function expectRefused(
    run: () => Promise<string>,
    message: RegExp,
  ): Promise<void> {
    let output = "";
    await expect(
      (async () => {
        output = await run();
      })(),
    ).rejects.toThrow(message);
    expect(output).not.toContain(B_SECRET);
    await expectTenantsUnchanged();
  }

  describe("db-query", () => {
    const refusedReads: Array<[string, string, RegExp]> = [
      [
        "a materialized view the per-user views do not shadow",
        "SELECT body FROM notes_mv",
        /"notes_mv" is not one of the app's tables/,
      ],
      [
        "a table in another schema",
        "SELECT body FROM archive.notes",
        /"archive" names a schema or database/,
      ],
      [
        "an app-defined SQL function",
        "SELECT leak_sql(body) FROM notes",
        /"leak_sql" matches an app-defined database function/,
      ],
      [
        "an app-defined PL/pgSQL function",
        "SELECT leak_plpgsql()",
        /"leak_plpgsql" matches an app-defined database function/,
      ],
      [
        "an app-defined function in attribute notation",
        "SELECT n.leak_attr FROM notes n",
        /"leak_attr" matches an app-defined database function/,
      ],
      [
        "an operator backed by an app-defined function",
        `SELECT id FROM notes WHERE body ==== '${B_SECRET}'`,
        /Operator "====" is backed by an app-defined database function/,
      ],
      [
        "an app-defined operator written before a sign",
        `SELECT id FROM notes WHERE body ====-'1'`,
        /Operator "====" is backed by an app-defined database function/,
      ],
      [
        "a built-in that runs SQL text",
        "SELECT query_to_xml('SELECT body FROM public.notes', true, false, '')",
        /"query_to_xml" is not available in agent SQL/,
      ],
      [
        "a built-in that changes the search path",
        "SELECT set_config('search_path', 'archive', true), body FROM notes",
        /"set_config" is not available in agent SQL/,
      ],
      [
        "a data-modifying CTE",
        "WITH gone AS (DELETE FROM notes RETURNING id) SELECT id FROM gone",
        /read-only transaction/,
      ],
      [
        "SELECT INTO",
        "SELECT * INTO stolen FROM notes",
        /read-only transaction/,
      ],
      [
        "EXPLAIN ANALYZE of a write",
        "EXPLAIN ANALYZE DELETE FROM notes",
        /read-only transaction/,
      ],
    ];
    for (const [label, sql, message] of refusedReads) {
      it(`refuses ${label}`, async () => {
        await expectRefused(() => dbQuery(sql), message);
      });
    }

    it("leaves no table behind after a refused SELECT INTO", async () => {
      await expect(
        dbQuery("SELECT * INTO stolen FROM notes"),
      ).rejects.toThrow();
      const [row] = await admin<{ name: string | null }>(
        `SELECT to_regclass('public.stolen')::text AS name`,
      );
      expect(row.name).toBeNull();
    });

    it("applies --limit after a trailing comment", async () => {
      const output = await dbQuery("SELECT body FROM notes -- newest first", [
        "--limit",
        "1",
      ]);
      expect(JSON.parse(output).rows).toHaveLength(1);
    });

    it("still answers ordinary reads with only the current tenant's rows", async () => {
      const output = await dbQuery(
        "SELECT n.id, upper(n.body) AS body, pg_typeof(n.body)::text AS type FROM notes n WHERE EXTRACT(year FROM now()) > 2000 ORDER BY n.id",
      );
      expect(JSON.parse(output).rows).toEqual([
        { id: "a1", body: "A-ONE", type: "text" },
        { id: "a2", body: "A-TWO", type: "text" },
      ]);
    });
  });

  describe("db-exec", () => {
    const refusedWrites: Array<[string, string, RegExp]> = [
      [
        "an INSERT without a column list into a table with access-control columns",
        "INSERT INTO notes VALUES ('a3', 'b@x.com', 'planted')",
        /must list its columns/,
      ],
      [
        "a multi-column SET that reaches an access-control column",
        "UPDATE notes SET (body, owner_email) = ('moved', 'b@x.com') WHERE id = 'a1'",
        /access-control/,
      ],
      [
        "ON CONFLICT DO UPDATE of an access-control column",
        "INSERT INTO notes (id, body) VALUES ('a1', 'x') ON CONFLICT (id) DO UPDATE SET owner_email = 'b@x.com'",
        /access-control/,
      ],
      [
        "a write that reads another schema",
        "UPDATE notes SET body = (SELECT body FROM archive.notes WHERE id = 'b1') WHERE id = 'a1'",
        /"archive" names a schema or database/,
      ],
      [
        "a write that calls an app-defined function",
        "UPDATE notes SET body = leak_sql(body) WHERE id = 'a1'",
        /"leak_sql" matches an app-defined database function/,
      ],
    ];
    for (const [label, sql, message] of refusedWrites) {
      it(`refuses ${label}`, async () => {
        await expectRefused(() => dbExec(["--sql", sql]), message);
      });
    }

    it("rolls back the whole batch when a later statement is refused", async () => {
      await expectRefused(
        () =>
          dbExec([
            "--statements",
            JSON.stringify([
              { sql: "UPDATE notes SET body = 'changed' WHERE id = 'a1'" },
              {
                sql: "UPDATE notes SET body = (SELECT body FROM notes_mv WHERE id = 'b1') WHERE id = 'a2'",
              },
            ]),
          ]),
        /Statement 2: "notes_mv" is not one of the app's tables/,
      );
    });

    it("still runs ordinary writes, owned by the current tenant", async () => {
      await dbExec([
        "--sql",
        "INSERT INTO notes (id, body) VALUES ('a3', 'A-three mentions owner_email')",
      ]);
      await dbExec([
        "--sql",
        "UPDATE notes SET body = 'A-edited' WHERE id = 'a1'",
      ]);
      const rows = await admin(
        `SELECT id, owner_email, body FROM public.notes ORDER BY id`,
      );
      expect(rows).toEqual([
        { id: "a1", owner_email: "a@x.com", body: "A-edited" },
        { id: "a2", owner_email: "a@x.com", body: "A-two" },
        {
          id: "a3",
          owner_email: "a@x.com",
          body: "A-three mentions owner_email",
        },
        { id: "b1", owner_email: "b@x.com", body: B_SECRET },
      ]);
    });
  });

  describe("db-patch --where", () => {
    const refusedWheres: Array<[string, string, RegExp]> = [
      [
        "another schema",
        "id = 'a1' AND EXISTS (SELECT 1 FROM archive.notes WHERE body = 'B-secret')",
        /"archive" names a schema or database/,
      ],
      [
        "a relation the per-user views do not shadow",
        "id = (SELECT 'a1' FROM notes_mv WHERE body = 'B-secret')",
        /"notes_mv" is not one of the app's tables/,
      ],
      [
        "an app-defined function",
        "id = 'a1' AND leak_sql(body) IS NOT NULL",
        /"leak_sql" matches an app-defined database function/,
      ],
      [
        "a denied built-in",
        "id = 'a1' AND current_setting('search_path') IS NOT NULL",
        /"current_setting" is not available in agent SQL/,
      ],
    ];
    for (const [label, where, message] of refusedWheres) {
      it(`refuses a clause that reaches ${label}`, async () => {
        await expectRefused(() => dbPatch(where), message);
      });
    }

    it("still patches the current tenant's row", async () => {
      await dbPatch("id = 'a1'");
      const [row] = await admin<{ body: string }>(
        `SELECT body FROM public.notes WHERE id = 'a1'`,
      );
      expect(row.body).toBe("Z-one");
      const [other] = await admin<{ body: string }>(
        `SELECT body FROM public.notes WHERE id = 'b1'`,
      );
      expect(other.body).toBe(B_SECRET);
    });
  });
});
