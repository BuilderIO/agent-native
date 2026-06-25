import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * db-patch is the agent's surgical search-and-replace + JSON-op tool. None of
 * the interesting logic (validateWhere, the JSON-op engine, strict-uniqueness
 * matching) is exported, so we drive everything through the real default
 * export.
 *
 * For tests that VERIFY THE WRITTEN VALUE, we drive a mocked Postgres backend:
 *   - In production (Neon Postgres) db-patch's scoped temp views are
 *     auto-updatable single-table views WITH LOCAL CHECK OPTION, so the UPDATE
 *     through the view succeeds and the patch engine's output is what lands.
 *   - The mock records the SELECT result and captures the UPDATE bind value so
 *     we can assert exactly what applyEdits / the JSON-op engine produced.
 * (See the SQLite section below for the desktop/local path, which surfaces a
 * genuine view-write bug.)
 *
 * For tests that only check validation / no-write behavior we use a real
 * temp-file SQLite database since no write is attempted.
 */
describe("db-patch", () => {
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
    dir = await mkdtemp(path.join(os.tmpdir(), "db-patch-"));
    dbFile = path.join(dir, "app.db");
    url = "file:" + dbFile;
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE documents (id TEXT PRIMARY KEY, owner_email TEXT, content TEXT)`,
      );
    });
    vi.stubEnv("AGENT_USER_EMAIL", "owner@x.com");
  });

  afterEach(async () => {
    // doMock registrations are file-scoped and survive resetModules; clear them
    // so the SQLite tests (which use the real client) don't inherit a partial
    // Postgres mock of ../../db/client.js from an earlier test.
    vi.doUnmock("postgres");
    vi.doUnmock("../../db/client.js");
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  // ── Postgres-backed harness (write verification) ────────────────────────
  //
  // Mocks `postgres` so db-patch's runPostgres path runs against an in-memory
  // fake: the SELECT returns `initialValue`, the UPDATE captures the new value.
  interface PgHarness {
    /** The value the UPDATE wrote, or undefined if no UPDATE ran. */
    written: () => string | undefined;
    /** All UPDATE statements seen. */
    updateCount: () => number;
  }

  function mockPg(opts: {
    table: string;
    columns: string[];
    selectRows: Record<string, unknown>[];
  }): PgHarness {
    let captured: string | undefined;
    let updates = 0;

    const introspectRows = opts.columns.map((c) => ({
      table_name: opts.table,
      column_name: c,
    }));

    const unsafe = vi.fn(async (sql: string, args?: unknown[]) => {
      const lower = sql.toLowerCase();
      if (lower.includes("temporary view") || lower.startsWith("drop view")) {
        return [];
      }
      if (lower.startsWith("select")) {
        return opts.selectRows;
      }
      if (lower.startsWith("update")) {
        updates++;
        captured = (args?.[0] as string) ?? undefined;
        return Object.assign([], { count: 1 });
      }
      return [];
    });

    // The introspection query is the tagged-template call on tx.
    const introspect = vi.fn(async () => introspectRows);
    const tx: any = Object.assign(introspect, { unsafe });
    const pgSql: any = Object.assign(introspect, {
      unsafe,
      end: vi.fn(),
      begin: async (fn: any) => fn(tx),
    });

    vi.doMock("postgres", () => ({ default: () => pgSql }));
    vi.doMock("../../db/client.js", () => ({
      getDatabaseUrl: () => "postgres://qa.example/db",
      getDatabaseAuthToken: () => undefined,
    }));

    return {
      written: () => captured,
      updateCount: () => updates,
    };
  }

  async function runPatchPg(harness: PgHarness, extra: string[]): Promise<any> {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      });
    try {
      const { default: dbPatch } = await import("./patch.js");
      await dbPatch(["--format", "json", ...extra]);
    } finally {
      spy.mockRestore();
    }
    const joined = logs.join("\n");
    const start = joined.indexOf("{");
    return start >= 0 ? JSON.parse(joined.slice(start)) : null;
  }

  // ── SQLite harness (validation / no-write paths) ────────────────────────
  async function seedDoc(id: string, owner: string, content: string) {
    await withClient((c) =>
      c.execute({
        sql: `INSERT INTO documents VALUES (?, ?, ?)`,
        args: [id, owner, content],
      }),
    );
  }

  // ── Argument validation (no DB touch) ──────────────────────────────────
  describe("argument validation", () => {
    it("rejects a non-identifier table name (SQL injection via --table)", async () => {
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents; DROP TABLE documents",
          "--column",
          "content",
          "--where",
          "id='d1'",
          "--find",
          "a",
          "--replace",
          "b",
        ]),
      ).rejects.toThrow(/Invalid --table/);
    });

    it("rejects a non-identifier column name", async () => {
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content = x, owner_email",
          "--where",
          "id='d1'",
          "--find",
          "a",
          "--replace",
          "b",
        ]),
      ).rejects.toThrow(/Invalid --column/);
    });

    it("rejects a WHERE clause that chains statements", async () => {
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id='d1'; DELETE FROM documents",
          "--find",
          "a",
          "--replace",
          "b",
        ]),
      ).rejects.toThrow(/no statement chaining/);
    });

    it("rejects a WHERE clause containing a blocked DDL keyword", async () => {
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id = 'd1' OR 1=1 DROP TABLE documents",
          "--find",
          "a",
          "--replace",
          "b",
        ]),
      ).rejects.toThrow(/--where must not contain "DROP"/);
    });

    it("rejects a WHERE clause with a SQL comment", async () => {
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id = 'd1' -- and the rest",
          "--find",
          "a",
          "--replace",
          "b",
        ]),
      ).rejects.toThrow(/--where must not contain "--"/);
    });

    it("rejects a ';' even when it is inside a quoted string literal (the ';' check runs before string-stripping)", async () => {
      // validateWhere checks for ';' on the raw clause BEFORE stripping string
      // literals, so unlike the DDL-keyword denylist there is no carve-out for
      // a semicolon hidden in a quoted value. This is the conservative-by-design
      // asymmetry: a stray ';' is always refused, the throw happens before any
      // DB connection, and the SQLite victim DB is never touched.
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id = 'a;b'",
          "--find",
          "a",
          "--replace",
          "b",
        ]),
      ).rejects.toThrow(/no statement chaining/);
    });

    it("allows a blocked keyword that only appears inside a quoted string literal", async () => {
      // "DROP TABLE" lives entirely inside the string literal, so validateWhere
      // strips it before scanning. With a Postgres backend the patch goes
      // through and the engine output is written.
      const h = mockPg({
        table: "documents",
        columns: ["id", "owner_email", "content"],
        selectRows: [{ __val: "needle here" }],
      });
      const out = await runPatchPg(h, [
        "--table",
        "documents",
        "--column",
        "content",
        "--where",
        "id = 'd1' AND content != 'DROP TABLE foo'",
        "--find",
        "needle",
        "--replace",
        "pin",
      ]);
      expect(out.applied).toBe(1);
      expect(h.written()).toBe("pin here");
    });

    it("requires an edit mode (--find or --edits)", async () => {
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id='d1'",
        ]),
      ).rejects.toThrow(/Either --find\/--replace or --edits is required/);
    });

    it("rejects an empty --find (passed as --find= so parseArgs keeps it empty)", async () => {
      // `--find ""` would be parsed as a boolean flag; `--find=` preserves the
      // empty value, which is the case the empty-find guard rejects.
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id='d1'",
          "--find=",
        ]),
      ).rejects.toThrow(/--find cannot be empty/);
    });

    it("rejects an --edits payload that is not a non-empty array", async () => {
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id='d1'",
          "--edits",
          "[]",
        ]),
      ).rejects.toThrow(/non-empty JSON array/);
    });
  });

  // ── Text edits: strict uniqueness, not-found, replaceAll (Postgres) ─────
  describe("text edits", () => {
    function docPg(content: string): PgHarness {
      return mockPg({
        table: "documents",
        columns: ["id", "owner_email", "content"],
        selectRows: [{ __val: content }],
      });
    }

    it("applies a single unambiguous find/replace", async () => {
      const h = docPg("the quik brown fox");
      const out = await runPatchPg(h, [
        "--table",
        "documents",
        "--column",
        "content",
        "--where",
        "id = 'd1'",
        "--find",
        "quik",
        "--replace",
        "quick",
      ]);
      expect(out.applied).toBe(1);
      expect(out.results[0].status).toBe("replaced");
      expect(h.written()).toBe("the quick brown fox");
    });

    it("reports not-found, applies nothing, and runs no UPDATE when find is absent", async () => {
      const h = docPg("hello world");
      const out = await runPatchPg(h, [
        "--table",
        "documents",
        "--column",
        "content",
        "--where",
        "id = 'd1'",
        "--find",
        "absent",
        "--replace",
        "x",
      ]);
      expect(out.applied).toBe(0);
      expect(out.results[0].status).toBe("not-found");
      expect(h.updateCount()).toBe(0);
    });

    it("refuses an ambiguous match by default (strict uniqueness) and writes nothing", async () => {
      const h = docPg("foo and foo and foo");
      const out = await runPatchPg(h, [
        "--table",
        "documents",
        "--column",
        "content",
        "--where",
        "id = 'd1'",
        "--find",
        "foo",
        "--replace",
        "bar",
      ]);
      expect(out.applied).toBe(0);
      expect(out.results[0].status).toBe("not-found");
      expect(out.results[0].occurrences).toBe(3);
      expect(out.results[0].detail).toContain("3 occurrences");
      expect(h.updateCount()).toBe(0);
    });

    it("replaces every occurrence with --all", async () => {
      const h = docPg("foo and foo and foo");
      const out = await runPatchPg(h, [
        "--table",
        "documents",
        "--column",
        "content",
        "--where",
        "id = 'd1'",
        "--find",
        "foo",
        "--replace",
        "bar",
        "--all",
      ]);
      expect(out.applied).toBe(1);
      expect(out.results[0].occurrences).toBe(3);
      expect(h.written()).toBe("bar and bar and bar");
    });

    it("treats an empty replace as a deletion", async () => {
      const h = docPg("keep[DROP]end");
      const out = await runPatchPg(h, [
        "--table",
        "documents",
        "--column",
        "content",
        "--where",
        "id = 'd1'",
        "--find",
        "[DROP]",
      ]);
      expect(out.results[0].status).toBe("deleted");
      expect(h.written()).toBe("keepend");
    });

    it("applies a batch of --edits sequentially against the evolving content", async () => {
      // The second edit's `find` only exists after the first edit runs.
      const h = docPg("alpha");
      const out = await runPatchPg(h, [
        "--table",
        "documents",
        "--column",
        "content",
        "--where",
        "id = 'd1'",
        "--edits",
        JSON.stringify([
          { find: "alpha", replace: "beta" },
          { find: "beta", replace: "gamma" },
        ]),
      ]);
      expect(out.applied).toBe(2);
      expect(h.written()).toBe("gamma");
    });

    it("reports zero matching rows distinctly from zero text matches", async () => {
      const h = mockPg({
        table: "documents",
        columns: ["id", "owner_email", "content"],
        selectRows: [],
      });
      void h;
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id = 'does-not-exist'",
          "--find",
          "a",
          "--replace",
          "b",
        ]),
      ).rejects.toThrow(/No rows matched/);
    });

    it("refuses to patch when the WHERE clause matches more than one row", async () => {
      mockPg({
        table: "documents",
        columns: ["id", "owner_email", "content"],
        selectRows: [{ __val: "one" }, { __val: "two" }],
      });
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "owner_email = 'owner@x.com'",
          "--find",
          "o",
          "--replace",
          "0",
        ]),
      ).rejects.toThrow(/expects exactly one row/);
    });

    it("rejects a non-text column value", async () => {
      mockPg({
        table: "documents",
        columns: ["id", "owner_email", "content"],
        selectRows: [{ __val: 42 }],
      });
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id = 'd1'",
          "--find",
          "a",
          "--replace",
          "b",
        ]),
      ).rejects.toThrow(/is not a text column/);
    });
  });

  // ── JSON ops engine (Postgres) ──────────────────────────────────────────
  describe("json-ops", () => {
    function deckPg(data: unknown): PgHarness {
      return mockPg({
        table: "decks",
        columns: ["id", "owner_email", "data"],
        selectRows: [{ __val: JSON.stringify(data) }],
      });
    }

    async function runDeckOps(
      h: PgHarness,
      ops: unknown[],
    ): Promise<{ out: any; result: any }> {
      const out = await runPatchPg(h, [
        "--table",
        "decks",
        "--column",
        "data",
        "--where",
        "id = 'd1'",
        "--json-ops",
        JSON.stringify(ops),
      ]);
      const written = h.written();
      return { out, result: written ? JSON.parse(written) : undefined };
    }

    it("sets a nested value via JSON Pointer", async () => {
      const h = deckPg({ panels: [{ title: "Q3" }, { title: "stay" }] });
      const { out, result } = await runDeckOps(h, [
        { op: "set", path: "/panels/0/title", value: "Q4" },
      ]);
      expect(out.applied).toBe(1);
      expect(result.panels[0].title).toBe("Q4");
      expect(result.panels[1].title).toBe("stay");
    });

    it("removes an object key and splices an array element", async () => {
      const h = deckPg({ keep: 1, drop: 2, list: ["a", "b", "c"] });
      const { out, result } = await runDeckOps(h, [
        { op: "remove", path: "/drop" },
        { op: "remove", path: "/list/1" },
      ]);
      expect(out.applied).toBe(2);
      expect(result).not.toHaveProperty("drop");
      expect(result.keep).toBe(1);
      expect(result.list).toEqual(["a", "c"]);
    });

    it("inserts into an array at an index and at the '-' append position", async () => {
      const h = deckPg({ list: ["a", "c"] });
      const { out, result } = await runDeckOps(h, [
        { op: "insert", path: "/list/1", value: "b" },
        { op: "insert", path: "/list/-", value: "d" },
      ]);
      expect(out.applied).toBe(2);
      expect(result.list).toEqual(["a", "b", "c", "d"]);
    });

    it("move-before reorders an array element so it lands at the requested index", async () => {
      // Move index 3 to index 1; final order must be a, d, b, c.
      const h = deckPg({ list: ["a", "b", "c", "d"] });
      const { out, result } = await runDeckOps(h, [
        { op: "move-before", from: "/list/3", path: "/list/1" },
      ]);
      expect(out.applied).toBe(1);
      expect(result.list).toEqual(["a", "d", "b", "c"]);
    });

    it("move forward (to a higher index in the same array) shifts the target down by one after the source splice", async () => {
      // Move index 0 to index 2 within the same array. The source splice removes
      // "a" first (→ b, c, d) and because target 2 > source 0 the destination is
      // decremented to 1, so "a" is reinserted at index 1 → b, a, c, d. This is
      // the stable-index convention shared with move-before.
      const h = deckPg({ list: ["a", "b", "c", "d"] });
      const { out, result } = await runDeckOps(h, [
        { op: "move", from: "/list/0", path: "/list/2" },
      ]);
      expect(out.applied).toBe(1);
      expect(result.list).toEqual(["b", "a", "c", "d"]);
    });

    it("records a per-op failure without aborting surviving ops, and writes the partial result", async () => {
      const h = deckPg({ list: ["a", "b"] });
      const { out, result } = await runDeckOps(h, [
        { op: "set", path: "/list/0", value: "Z" },
        // Out-of-bounds parent walk → this op fails but must not discard op 0.
        { op: "set", path: "/list/9/deep", value: "x" },
      ]);
      expect(out.applied).toBe(1);
      expect(out.results[0].status).toBe("replaced");
      expect(out.results[1].status).toBe("not-found");
      expect(out.results[1].detail).toContain("FAILED");
      expect(result.list[0]).toBe("Z");
    });

    it("fails the whole run when the column is not valid JSON", async () => {
      mockPg({
        table: "decks",
        columns: ["id", "owner_email", "data"],
        selectRows: [{ __val: "not json {" }],
      });
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--table",
          "decks",
          "--column",
          "data",
          "--where",
          "id = 'd1'",
          "--json-ops",
          JSON.stringify([{ op: "set", path: "/x", value: 1 }]),
        ]),
      ).rejects.toThrow(/requires the column value to be valid JSON/);
    });

    it("rejects a json-ops payload whose entries are not op objects", async () => {
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id = 'd1'",
          "--json-ops",
          JSON.stringify(["not-an-op"]),
        ]),
      ).rejects.toThrow(/Each op must be an object with an 'op' field/);
    });

    it("escapes JSON Pointer ~1 (slash) and ~0 (tilde) in key segments", async () => {
      const h = deckPg({ "a/b": { "c~d": "old" } });
      const { out, result } = await runDeckOps(h, [
        { op: "set", path: "/a~1b/c~0d", value: "new" },
      ]);
      expect(out.applied).toBe(1);
      expect(result["a/b"]["c~d"]).toBe("new");
    });

    it("rejects a JSON path that does not start with '/'", async () => {
      const h = deckPg({ x: 1 });
      const { out } = await runDeckOps(h, [{ op: "set", path: "x", value: 2 }]);
      // The op fails individually (caught) → recorded as a failed op, nothing
      // applied, no write.
      expect(out.applied).toBe(0);
      expect(out.results[0].detail).toContain("FAILED");
      expect(h.updateCount()).toBe(0);
    });
  });

  // ── Scoping / safety (SQLite, no successful write needed) ───────────────
  describe("scoping and safety (SQLite)", () => {
    it("cannot read a row owned by another user (it appears as no-rows)", async () => {
      await seedDoc("victim", "other@x.com", "victim content");
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id = 'victim'",
          "--find",
          "victim",
          "--replace",
          "pwned",
        ]),
      ).rejects.toThrow(/No rows matched/);
      // The victim's row is byte-for-byte intact.
      const stillThere = await withClient((c) =>
        c
          .execute({
            sql: `SELECT content FROM documents WHERE id = ?`,
            args: ["victim"],
          })
          .then((r) => (r.rows[0]?.content ?? r.rows[0]?.[0]) as string),
      );
      expect(stillThere).toBe("victim content");
    });

    it("refuses to run when there is no authenticated user identity", async () => {
      vi.stubEnv("AGENT_USER_EMAIL", "");
      await seedDoc("d1", "owner@x.com", "x");
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id = 'd1'",
          "--find",
          "x",
          "--replace",
          "y",
        ]),
      ).rejects.toThrow(/require an authenticated user identity/);
    });

    it("rejects the dev sentinel identity (local@localhost)", async () => {
      vi.stubEnv("AGENT_USER_EMAIL", "local@localhost");
      await seedDoc("d1", "owner@x.com", "x");
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id = 'd1'",
          "--find",
          "x",
          "--replace",
          "y",
        ]),
      ).rejects.toThrow(/require an authenticated user identity/);
    });

    it('writes a scoped patch to main."table" (SQLite views are not updatable, so the UPDATE must target the real table with the scope predicate re-applied)', async () => {
      await seedDoc("d1", "owner@x.com", "the quik brown fox");
      const { default: dbPatch } = await import("./patch.js");
      // The SELECT reads through the scoped temp view; the UPDATE must NOT —
      // it targets main."documents" with the view's owner_email predicate
      // re-applied, so the patch lands on the real table without ever exposing
      // a row the SELECT couldn't see.
      await dbPatch([
        "--db",
        dbFile,
        "--table",
        "documents",
        "--column",
        "content",
        "--where",
        "id = 'd1'",
        "--find",
        "quik",
        "--replace",
        "quick",
      ]);
      const after = await withClient((c) =>
        c
          .execute({
            sql: `SELECT content FROM documents WHERE id = ?`,
            args: ["d1"],
          })
          .then((r) => (r.rows[0]?.content ?? r.rows[0]?.[0]) as string),
      );
      expect(after).toBe("the quick brown fox");
    });

    it("refuses to patch a row owned by a different user under SQLite scoping (the re-applied predicate blocks the cross-tenant write)", async () => {
      // The row exists but belongs to someone else. The scoped SELECT can't see
      // it, so db-patch reports "no rows matched" and never issues the UPDATE —
      // the cross-tenant row must stay untouched.
      await seedDoc("d-other", "someone-else@x.com", "secret value");
      const { default: dbPatch } = await import("./patch.js");
      await expect(
        dbPatch([
          "--db",
          dbFile,
          "--table",
          "documents",
          "--column",
          "content",
          "--where",
          "id = 'd-other'",
          "--find",
          "secret",
          "--replace",
          "leaked",
        ]),
      ).rejects.toThrow(/No rows matched/);
      const after = await withClient((c) =>
        c
          .execute({
            sql: `SELECT content FROM documents WHERE id = ?`,
            args: ["d-other"],
          })
          .then((r) => (r.rows[0]?.content ?? r.rows[0]?.[0]) as string),
      );
      expect(after).toBe("secret value");
    });
  });
});
