import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readAgentPostgresStatement,
  verifyAgentPostgresExpressions,
  verifyAgentPostgresResolution,
} from "./postgres.js";

describe("Postgres expression checks independent of raw relation scoping", () => {
  let client: PGlite;

  beforeAll(async () => {
    client = await PGlite.create();
    await client.exec(`
      CREATE TABLE notes (id text, owner_email text, body text);
      INSERT INTO notes VALUES
        ('a1', 'a@example.test', 'A-one'),
        ('b1', 'b@example.test', 'B-secret');
      CREATE FUNCTION leak_attr(anyelement) RETURNS text LANGUAGE sql AS
        $$ SELECT string_agg(body, ',') FROM public.notes $$;
      CREATE FUNCTION permitted_value(text) RETURNS boolean LANGUAGE sql AS
        $$ SELECT EXISTS (SELECT 1 FROM public.notes WHERE body = $1) $$;
      CREATE DOMAIN note_value AS text CHECK (permitted_value(VALUE));
      CREATE SCHEMA archive;
      CREATE DOMAIN archive.archived_value AS text CHECK (permitted_value(VALUE));
      CREATE FUNCTION leak_op(text, text) RETURNS boolean LANGUAGE sql AS
        $$ SELECT EXISTS (SELECT 1 FROM public.notes WHERE body = $2) $$;
      CREATE OPERATOR ==== (LEFTARG = text, RIGHTARG = text, FUNCTION = leak_op);
    `);
  });

  afterAll(async () => {
    await client.close();
  });

  async function expressions(sql: string): Promise<void> {
    await client.transaction(async (transaction) => {
      await verifyAgentPostgresExpressions(
        {
          unsafe: async (query, args) =>
            (await transaction.query(query, args)).rows,
        },
        readAgentPostgresStatement(sql),
      );
    });
  }

  it("allows a catalog function on caller-scoped base rows without temp views", async () => {
    const statement = readAgentPostgresStatement(
      "SELECT pg_catalog.upper(body) AS body FROM notes WHERE owner_email = 'a@example.test'",
    );
    await client.transaction(async (transaction) => {
      const runner = {
        unsafe: async (query: string, args?: unknown[]) =>
          (await transaction.query(query, args)).rows,
      };
      await verifyAgentPostgresExpressions(runner, statement);
      expect((await transaction.query(statement.sql)).rows).toEqual([
        { body: "A-ONE" },
      ]);
      await expect(
        verifyAgentPostgresResolution(runner, statement),
      ).rejects.toThrow(/Schema-qualified names/);
    });
  });

  it("leaves base-relation refusal to the raw DB verification path", async () => {
    const statement = readAgentPostgresStatement("SELECT body FROM notes");
    await client.transaction(async (transaction) => {
      const runner = {
        unsafe: async (query: string, args?: unknown[]) =>
          (await transaction.query(query, args)).rows,
      };
      await verifyAgentPostgresExpressions(runner, statement);
      await expect(
        verifyAgentPostgresResolution(runner, statement),
      ).rejects.toThrow(/"notes" is not one of the app's tables/);
    });
  });

  it("refuses an app routine even when attribute notation hides a call", async () => {
    await expect(
      expressions("SELECT n.leak_attr FROM notes n"),
    ).rejects.toThrow(/"leak_attr" matches an app-defined database function/);
  });

  it("refuses an app operator without any relation references", async () => {
    await expect(expressions("SELECT 'x' ==== 'B-secret'")).rejects.toThrow(
      /Operator "===="/,
    );
  });

  it.each([
    "SELECT 'B-secret'::note_value",
    "SELECT CAST('B-secret' AS note_value)",
    "SELECT note_value('B-secret') AS body",
    "SELECT note_value 'B-secret'",
    "SELECT 'B-secret'::note_value[]",
  ])("refuses a domain conversion in %s", async (sql) => {
    await expect(expressions(sql)).rejects.toThrow(
      /"note_value" is not a built-in type/,
    );
  });

  it("refuses a type outside the search path in a qualified conversion", async () => {
    await expect(
      expressions("SELECT CAST('B-secret' AS archive.archived_value)"),
    ).rejects.toThrow(/"archived_value" is not a built-in type/);
  });

  it.each([
    "json_populate_record",
    "json_populate_recordset",
    "json_to_record",
    "json_to_recordset",
    "jsonb_populate_record",
    "jsonb_populate_recordset",
    "jsonb_populate_record_valid",
    "jsonb_to_record",
    "jsonb_to_recordset",
    "domain_in",
    "record_in",
    "array_in",
    "range_in",
    "multirange_in",
  ])("refuses generic type-input helper %s before execution", async (name) => {
    await expect(expressions(`SELECT ${name}('x')`)).rejects.toThrow(
      new RegExp(`"${name}" is not available in agent SQL`),
    );
  });

  it("requires the executing connection's standard string rules", async () => {
    await client.transaction(async (transaction) => {
      await transaction.exec("SET LOCAL standard_conforming_strings = off");
      await expect(
        verifyAgentPostgresExpressions(
          {
            unsafe: async (query, args) =>
              (await transaction.query(query, args)).rows,
          },
          readAgentPostgresStatement("SELECT 1"),
        ),
      ).rejects.toThrow(/standard_conforming_strings to be on/);
    });
  });
});
