import { describe, it, expect } from "vitest";

import {
  assertNoSchemaQualifiedTables,
  assertNoSensitiveFrameworkTables,
} from "./safety.js";

describe("assertNoSchemaQualifiedTables", () => {
  describe("rejects schema-qualified table references (scoping bypass)", () => {
    const blocked = [
      // Postgres prod: base tables live in `public`.
      "SELECT * FROM public.notes",
      "SELECT value FROM public.settings WHERE key = 'x'",
      "UPDATE public.notes SET body = 'x'",
      "DELETE FROM public.notes",
      "INSERT INTO public.notes (id) VALUES ('x')",
      // SQLite desktop: base tables live in `main`.
      "SELECT * FROM main.notes",
      "UPDATE main.notes SET body = 'x'",
      "DELETE FROM main.notes",
      // Variations that must not slip through.
      "select * from PUBLIC.notes",
      "SELECT * FROM ONLY public.notes",
      'SELECT * FROM "public"."notes"',
      "SELECT * FROM notes WHERE id IN (SELECT id FROM public.other)",
      "SELECT * FROM notes, public.other",
      "DELETE FROM notes USING public.audit WHERE notes.id = audit.id",
      "SELECT * FROM public /* c */ . notes",
      "SELECT * FROM information_schema.tables",
      "SELECT * FROM pg_catalog.pg_tables",
      // Cross-database qualification.
      "SELECT * FROM mydb.notes",
    ];
    for (const sql of blocked) {
      it(`rejects: ${sql}`, () => {
        expect(() => assertNoSchemaQualifiedTables(sql, "read")).toThrow(
          /schema-qualified/i,
        );
      });
    }
  });

  describe("allows ordinary unqualified queries", () => {
    const allowed = [
      "SELECT * FROM notes",
      "SELECT * FROM notes WHERE id = ?",
      "SELECT n.id, n.body FROM notes n WHERE n.owner_email = ?",
      "SELECT f.id FROM forms f JOIN submissions s ON s.form_id = f.id",
      "WITH cte AS (SELECT * FROM notes) SELECT * FROM cte",
      "UPDATE notes SET body = ? WHERE id = ?",
      "DELETE FROM notes WHERE id = ?",
      "INSERT INTO notes (id, body) VALUES (?, ?)",
      // A column literally named after a schema keyword is fine (it's on the
      // RIGHT of the dot, i.e. <alias>.<column>).
      "SELECT forms.public FROM forms",
      "SELECT t.main FROM things t",
      // Table whose name contains a dot (single quoted identifier).
      'SELECT * FROM "my.table"',
      // Numbers / string literals with dots are not table references.
      "SELECT 1.5 AS x FROM notes",
      "SELECT * FROM notes WHERE name = 'a.b.c'",
      "SELECT * FROM notes WHERE created_at > '2020-01-01'",
    ];
    for (const sql of allowed) {
      it(`allows: ${sql}`, () => {
        expect(() => assertNoSchemaQualifiedTables(sql, "read")).not.toThrow();
      });
    }
  });

  it("does not regress the sensitive-framework-table guard", () => {
    // Still blocks framework credential/identity tables (qualified or not).
    expect(() =>
      assertNoSensitiveFrameworkTables("SELECT * FROM oauth_tokens", "read"),
    ).toThrow();
    expect(() =>
      assertNoSensitiveFrameworkTables(
        "SELECT * FROM public.oauth_tokens",
        "read",
      ),
    ).toThrow();
  });
});
