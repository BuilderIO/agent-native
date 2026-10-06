import { describe, it, expect } from "vitest";

import {
  assertNoSensitiveFrameworkTables,
  finalRawDbSql,
  readRawDbReadStatement,
  readRawDbWriteStatement,
  validateRawDbPatchWhere,
} from "./safety.js";

// Static checks only. The database-side checks, and proof that rejected
// statements leave another tenant's rows untouched, are in
// agent-sql-guards.e2e.spec.ts.

function guardFor(sql: string) {
  const keyword = sql.trimStart().split(/\s+/)[0].toLowerCase();
  return ["insert", "update", "delete"].includes(keyword)
    ? () => readRawDbWriteStatement(sql)
    : () => readRawDbReadStatement(sql);
}

describe("schema-qualified names", () => {
  const blocked = [
    "SELECT * FROM public.notes",
    "SELECT value FROM public.settings WHERE key = 'x'",
    "UPDATE public.notes SET body = 'x'",
    "DELETE FROM public.notes",
    "INSERT INTO public.notes (id) VALUES ('x')",
    "select * from PUBLIC.notes",
    "SELECT * FROM ONLY public.notes",
    'SELECT * FROM "public"."notes"',
    "SELECT * FROM notes WHERE id IN (SELECT id FROM public.other)",
    "SELECT * FROM notes, public.other",
    "DELETE FROM notes USING public.audit WHERE notes.id = audit.id",
    "SELECT * FROM public /* c */ . notes",
    "SELECT * FROM public -- c\n . notes",
    "SELECT * FROM information_schema.tables",
    "SELECT * FROM pg_catalog.pg_tables",
    "SELECT * FROM main.notes",
    "SELECT * FROM pg_temp.notes",
    "SELECT * FROM postgres.public.notes",
    "SELECT n.* FROM app.public.notes n",
  ];
  for (const sql of blocked) {
    it(`rejects: ${JSON.stringify(sql)}`, () => {
      expect(guardFor(sql)).toThrow(/schema|database|not available/i);
    });
  }

  const allowed = [
    "SELECT * FROM notes",
    "SELECT * FROM notes WHERE id = ?",
    "SELECT n.id, n.body FROM notes n WHERE n.owner_email = ?",
    "SELECT f.id FROM forms f JOIN submissions s ON s.form_id = f.id",
    "WITH cte AS (SELECT * FROM notes) SELECT * FROM cte",
    "UPDATE notes SET body = ? WHERE id = ?",
    "DELETE FROM notes WHERE id = ?",
    "INSERT INTO notes (id, body) VALUES (?, ?)",
    "SELECT forms.public FROM forms",
    "SELECT t.main FROM things t",
    'SELECT * FROM "my.table"',
    "SELECT 1.5 AS x FROM notes",
    "SELECT * FROM notes WHERE name = 'a.b.c'",
    "SELECT * FROM notes WHERE name = 'public.notes'",
    "SELECT * FROM notes WHERE created_at > '2020-01-01'",
    "SELECT EXTRACT(year FROM n.created_at) FROM notes n",
    "SELECT $q$ public.notes $q$ FROM notes",
    "SELECT * FROM notes /* public.notes */",
  ];
  for (const sql of allowed) {
    it(`allows: ${JSON.stringify(sql)}`, () => {
      expect(guardFor(sql)).not.toThrow();
    });
  }

  it("leaves other two-part names to the in-transaction schema check", () => {
    // `mydb` could be a schema or a table alias; only the database knows.
    expect(() =>
      readRawDbReadStatement("SELECT * FROM mydb.notes"),
    ).not.toThrow();
  });
});

describe("text the lexer must read the way Postgres does", () => {
  it("sees a name after a line comment that ends at a carriage return", () => {
    expect(() =>
      readRawDbReadStatement(
        "SELECT body FROM notes -- c\rUNION SELECT body FROM public.notes",
      ),
    ).toThrow(/schema/i);
  });

  it("keeps a dollar sign after a non-ASCII space inside the identifier", () => {
    expect(() =>
      readRawDbReadStatement(
        "SELECT body FROM notes WHERE x $q$ = 1 OR id IN (SELECT id FROM public.notes)",
      ),
    ).toThrow(/schema/i);
  });

  it("does not let an escaped quote end an escape string early", () => {
    expect(() =>
      readRawDbReadStatement("SELECT E'\\' FROM public.notes' AS x FROM notes"),
    ).not.toThrow();
    expect(() =>
      readRawDbReadStatement("SELECT E'\\'' AS x FROM public.notes"),
    ).toThrow(/schema/i);
  });

  it("reads nested block comments to their real end", () => {
    expect(() =>
      readRawDbReadStatement(
        "SELECT body FROM notes /* a /* b */ c */ UNION SELECT body FROM public.notes",
      ),
    ).toThrow(/schema/i);
  });

  const unreadable = [
    'SELECT * FROM U&"notes"',
    "SELECT 'unterminated FROM notes",
    "SELECT * FROM notes /* unterminated",
    "SELECT $x$ unterminated FROM notes",
    "SELECT * FROM `notes`",
  ];
  for (const sql of unreadable) {
    it(`refuses unreadable SQL: ${JSON.stringify(sql)}`, () => {
      expect(() => readRawDbReadStatement(sql)).toThrow(/could not be read/i);
    });
  }
});

describe("statements and keywords", () => {
  it("refuses more than one statement", () => {
    expect(() => readRawDbReadStatement("SELECT 1; SELECT 2")).toThrow(
      /more than one statement/i,
    );
    expect(() =>
      readRawDbWriteStatement(
        "UPDATE notes SET body = 'x'; DELETE FROM notes",
        "Statement 1",
      ),
    ).toThrow(/Statement 1 contains multiple SQL statements/);
  });

  it("allows a trailing semicolon and a ';' inside a string", () => {
    expect(() => readRawDbReadStatement("SELECT 1;")).not.toThrow();
    expect(() =>
      readRawDbReadStatement("SELECT * FROM notes WHERE body = ';'"),
    ).not.toThrow();
  });

  it("returns the statement without its trailing semicolon or comment", () => {
    expect(readRawDbReadStatement("SELECT 1; -- done").sql).toBe("SELECT 1");
  });

  it("keeps db-query to reads and db-exec to writes", () => {
    for (const sql of [
      "UPDATE notes SET body = 'x'",
      "SET search_path = public",
      "COPY notes TO STDOUT",
      "DO $$ BEGIN END $$",
    ]) {
      expect(() => readRawDbReadStatement(sql)).toThrow(/Only SELECT/);
    }
    expect(() => readRawDbWriteStatement("SELECT 1")).toThrow(/use db-query/);
    expect(() =>
      readRawDbWriteStatement("ALTER TABLE notes ADD x int"),
    ).toThrow(/schema changes/);
    for (const sql of [
      "DROP TABLE notes",
      "TRUNCATE notes",
      "GRANT ALL ON notes TO x",
      "MERGE INTO notes USING x ON true WHEN MATCHED THEN DELETE",
    ]) {
      expect(() => readRawDbWriteStatement(sql)).toThrow(
        /only INSERT, UPDATE, DELETE/,
      );
    }
  });
});

describe("built-in functions that escape the per-user views", () => {
  const blocked = [
    "SELECT set_config('search_path', 'public', true)",
    "SELECT current_setting('search_path')",
    "SELECT query_to_xml('SELECT 1', true, false, '')",
    "SELECT table_to_xml('notes', true, false, '')",
    "SELECT * FROM dblink('dbname=x', 'SELECT 1') AS t(x int)",
    "SELECT pg_read_file('x')",
    "SELECT lo_import('x')",
    "SELECT pg_sleep(10)",
    "SELECT setval('notes_id_seq', 1)",
    "SELECT * FROM pg_class",
    "SELECT \"set_config\"('a', 'b', true)",
  ];
  for (const sql of blocked) {
    it(`rejects: ${JSON.stringify(sql)}`, () => {
      expect(() => readRawDbReadStatement(sql)).toThrow(
        /not available in agent SQL/,
      );
    });
  }

  it("allows the harmless type and size helpers", () => {
    expect(() =>
      readRawDbReadStatement(
        "SELECT pg_typeof(body), pg_column_size(body), pg_size_pretty(10::bigint) FROM notes",
      ),
    ).not.toThrow();
  });

  it("refuses identifiers longer than Postgres keeps", () => {
    expect(() =>
      readRawDbReadStatement(`SELECT * FROM ${"n".repeat(64)}`),
    ).toThrow(/longer than 63 bytes/);
  });
});

describe("sensitive framework tables", () => {
  it.each([
    "mcp_oauth_clients",
    "mcp_oauth_codes",
    "mcp_oauth_refresh_tokens",
    "mcp_connect_tokens",
    "mcp_device_codes",
  ])(
    "refuses MCP credential metadata in %s through every raw tool",
    (table) => {
      expect(() => readRawDbReadStatement(`SELECT * FROM "${table}"`)).toThrow(
        /Sensitive framework table/,
      );
      expect(() =>
        readRawDbWriteStatement(
          `UPDATE ${table} SET issued_for_email = 'other@example.test'`,
        ),
      ).toThrow(/Sensitive framework table/);
      expect(() => assertNoSensitiveFrameworkTables(table, "patch")).toThrow(
        /Sensitive framework table/,
      );
    },
  );

  it("rejects direct and qualified reads", () => {
    expect(() =>
      assertNoSensitiveFrameworkTables("SELECT * FROM oauth_tokens", "read"),
    ).toThrow(/Sensitive framework table/);
    expect(() => readRawDbReadStatement('SELECT * FROM "Sessions"')).toThrow(
      /Sensitive framework table "sessions"/,
    );
  });

  it("ignores the names inside strings and comments", () => {
    expect(() =>
      readRawDbReadStatement(
        "SELECT * FROM notes WHERE body = 'users' /* sessions */",
      ),
    ).not.toThrow();
  });
});

describe("access-control writes", () => {
  const blocked = [
    "UPDATE notes SET owner_email = 'b@x.com' WHERE id = 'n1'",
    "UPDATE notes SET (body, owner_email) = ('x', 'b@x.com')",
    "UPDATE notes SET body = 'x', is_admin = true",
    "UPDATE notes SET \"Role\" = 'admin'",
    "INSERT INTO notes (id, owner_email) VALUES ('x', 'b@x.com')",
    "INSERT INTO notes AS n (id, role) VALUES ('x', 'admin')",
    "UPDATE notes SET body = body IS DISTINCT FROM 'x', role = 'admin'",
    "UPDATE notes SET body = body IS NOT DISTINCT FROM 'x', role = 'admin'",
    "INSERT INTO notes (id, body) VALUES ('x', 'y') ON CONFLICT (id) DO UPDATE SET owner_email = 'b@x.com'",
    "UPDATE team_grants SET body = 'x'",
    "DELETE FROM user_roles WHERE id = 'x'",
  ];
  for (const sql of blocked) {
    it(`rejects: ${JSON.stringify(sql)}`, () => {
      expect(() => readRawDbWriteStatement(sql)).toThrow(/access-control/);
    });
  }

  const allowed = [
    "UPDATE notes SET body = 'role' WHERE owner_email = 'a@x.com'",
    "UPDATE notes SET tags = ARRAY[body, 'role'] WHERE id = 'x'",
    "UPDATE notes SET body = coalesce(body, 'x') WHERE id IN (SELECT id FROM roles_view)",
    "INSERT INTO notes (id, body) VALUES ('x', 'y') ON CONFLICT (id) DO UPDATE SET body = excluded.body",
    "INSERT INTO notes (SELECT id, body FROM drafts)",
  ];
  for (const sql of allowed) {
    it(`allows: ${JSON.stringify(sql)}`, () => {
      expect(() => readRawDbWriteStatement(sql)).not.toThrow();
    });
  }
});

describe("final executed text", () => {
  it("converts placeholders and re-reads the result", () => {
    const final = finalRawDbSql(
      "SELECT * FROM notes WHERE id = ? AND body = '?'",
      "read",
    );
    expect(final.sql).toBe("SELECT * FROM notes WHERE id = $1 AND body = '?'");
    expect(final.statement.keyword).toBe("select");
  });

  it("refuses text where placeholder conversion and Postgres disagree", () => {
    // toPostgresParams ends a line comment only at a newline; Postgres also
    // ends it at a carriage return, so this "?" would reach the database
    // unconverted.
    expect(() =>
      finalRawDbSql("SELECT 1 AS a -- c\r, ? AS b FROM notes", "read"),
    ).toThrow(/placeholders are ambiguous/);
  });
});

describe("db-patch --where", () => {
  it("keeps its existing refusals", () => {
    expect(() => validateRawDbPatchWhere("id = 'x'; DROP TABLE notes")).toThrow(
      /must not contain ';'/,
    );
    expect(() => validateRawDbPatchWhere("id = 'a;b'")).toThrow(
      /must not contain ';'/,
    );
    expect(() => validateRawDbPatchWhere("id = 'x' -- c")).toThrow(
      /must not contain "--"/,
    );
    expect(() => validateRawDbPatchWhere("id = 'x' /* c */")).toThrow(
      /must not contain "\/\*"/,
    );
    expect(() =>
      validateRawDbPatchWhere("id IN (DELETE FROM notes RETURNING id)"),
    ).toThrow(/must not contain "DELETE"/);
  });

  it("allows keywords and comment markers inside strings", () => {
    expect(() =>
      validateRawDbPatchWhere("body = 'DROP -- /* x' AND id = 'n1'"),
    ).not.toThrow();
  });
});
