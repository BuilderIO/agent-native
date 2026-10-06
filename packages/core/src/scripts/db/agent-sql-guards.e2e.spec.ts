import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { tablefunc } from "@electric-sql/pglite/contrib/tablefunc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../../server/request-context.js";
import { createPostgresScriptClient } from "./postgres-client.js";
import { finalRawDbSql, verifyRawDbStatement } from "./safety.js";
import { buildScopingPostgres } from "./scoping.js";

// Two synthetic tenants in a local PGlite database. Each case runs a raw-DB
// tool as tenant A, checks the refusal, then checks tenant B's row is
// unchanged and never reached A's output.

const B_SECRET = "B-secret";

it("refuses an extension function that executes SQL outside scoped views", async () => {
  const client = await PGlite.create({ extensions: { tablefunc } });
  try {
    await client.exec(`
      CREATE EXTENSION tablefunc;
      CREATE TABLE notes (id text PRIMARY KEY, owner_email text, body text);
      INSERT INTO notes VALUES
        ('a1', 'a@example.test', 'A-one'),
        ('b1', 'b@example.test', 'B-secret');
    `);
    const executed = finalRawDbSql(
      "SELECT body FROM crosstab('SELECT id, ''body'', body FROM public.notes ORDER BY 1') AS result(id text, body text)",
      "read",
    );
    await expect(
      runWithRequestContext({ userEmail: "a@example.test" }, () =>
        client.transaction(async (transaction) => {
          const runner = {
            unsafe: async (sql: string, args?: unknown[]) =>
              (await transaction.query(sql, args)).rows,
          };
          const scoping = await buildScopingPostgres(runner);
          for (const setup of scoping.setup) await runner.unsafe(setup);
          await runner.unsafe("SET TRANSACTION READ ONLY");
          await verifyRawDbStatement(runner, executed.statement);
          await runner.unsafe(executed.sql);
        }),
      ),
    ).rejects.toThrow(/"crosstab" matches an app-defined database function/);
    expect(
      (await client.query("SELECT body FROM notes ORDER BY id")).rows,
    ).toEqual([{ body: "A-one" }, { body: "B-secret" }]);
  } finally {
    await client.close();
  }
});

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
      `CREATE SEQUENCE unrelated_sequence START 7`,
      `CREATE FUNCTION permitted_value(text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM public.notes WHERE body = $1) $$`,
      `CREATE DOMAIN note_value AS text CHECK (permitted_value(VALUE))`,
      `CREATE TABLE domain_notes (id text, owner_email text, body note_value)`,
      `INSERT INTO domain_notes SELECT * FROM notes`,
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
    it.each([
      "SELECT '(x,a@x.com,B-secret)'::domain_notes",
      "SELECT CAST('(x,a@x.com,B-secret)' AS domain_notes)",
      "SELECT domain_notes('(x,a@x.com,B-secret)')",
      "SELECT domain_notes '(x,a@x.com,B-secret)'",
    ])("refuses scoped composite input conversion through %s", async (sql) => {
      await expectRefused(
        () => dbQuery(sql),
        /"domain_notes" is not a built-in type/,
      );
    });

    it.each(["json_populate_record", "jsonb_populate_record"])(
      "refuses implicit domain conversion through %s",
      async (name) => {
        await expectRefused(
          () =>
            dbQuery(
              `SELECT (${name}(n, '{"body":"B-secret"}')).body FROM domain_notes n`,
            ),
          /"jsonb?_populate_record" is not available in agent SQL/,
        );
      },
    );

    const refusedReads: Array<[string, string, RegExp]> = [
      [
        "an app-defined domain that invokes a function during a cast",
        "SELECT 'B-secret'::note_value",
        /"note_value" is not a built-in type/,
      ],
      [
        "an app-defined domain in CAST syntax",
        "SELECT CAST('B-secret' AS note_value)",
        /"note_value" is not a built-in type/,
      ],
      [
        "escape-string continuation with inherited quoting rules",
        "SELECT E'head'\n'one\\' two' AS label, body FROM public.notes --'",
        /Continuation after an escape string/,
      ],
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
        "text-search statistics that execute SQL text",
        "SELECT word FROM ts_stat('SELECT to_tsvector(body) FROM public.notes')",
        /"ts_stat" is not available in agent SQL/,
      ],
      [
        "text-search rewriting that executes SQL text",
        "SELECT ts_rewrite('needle'::tsquery, 'SELECT ''needle''::tsquery, to_tsquery(body) FROM public.notes')",
        /"ts_rewrite" is not available in agent SQL/,
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

    it.each(["currval('public.unrelated_sequence')", "lastval()"])(
      "refuses unrelated sequence state through %s",
      async (expression) => {
        await admin("SELECT nextval('public.unrelated_sequence')");
        await expectRefused(
          () => dbQuery(`SELECT ${expression}`),
          /"(?:currval|lastval)" is not available in agent SQL/,
        );
      },
    );

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

    it("reads scoped rows whose existing fields have an app-defined domain", async () => {
      const output = await dbQuery(
        "SELECT n.id, n.body FROM domain_notes n ORDER BY n.id",
      );
      expect(JSON.parse(output).rows).toEqual([
        { id: "a1", body: "A-one" },
        { id: "a2", body: "A-two" },
      ]);
    });
  });

  describe("db-exec", () => {
    it("refuses sequence advancement without changing the sequence", async () => {
      await expectRefused(
        () =>
          dbExec([
            "--sql",
            "UPDATE notes SET body = nextval('public.unrelated_sequence')::text",
          ]),
        /"nextval" is not available in agent SQL/,
      );
      expect(
        await admin(
          "SELECT last_value, is_called FROM public.unrelated_sequence",
        ),
      ).toEqual([{ last_value: 7, is_called: false }]);
    });

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
