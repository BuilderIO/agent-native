/**
 * Postgres-dialect verification for the DB-admin introspection path.
 *
 * The main `operations.spec.ts` runs against a real local SQLite file. We have
 * no local Postgres in CI/dev, so this file mocks `../db/client.js` to report
 * the Postgres dialect and return canned `information_schema` / `pg_*` rows.
 * That verifies the dialect-specific branch end-to-end — that introspection
 * issues the Postgres queries (NOT `sqlite_master`/`PRAGMA`) and parses their
 * results (columns, nullability, PK, FK, indexes, serial autoIncrement)
 * correctly — without needing a live Postgres.
 *
 * A live Postgres run (the full suite against a real `DATABASE_URL`) is the
 * stronger check and remains the open item; this closes the query-shape +
 * parsing risk, which is where the SQLite vs Postgres code actually diverges.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let executed: string[] = [];

vi.mock("../db/client.js", () => {
  const execute = async (sqlOrObj: unknown) => {
    const sql =
      typeof sqlOrObj === "string"
        ? sqlOrObj
        : (sqlOrObj as { sql: string }).sql;
    executed.push(sql);
    const norm = sql.replace(/\s+/g, " ").trim();

    if (
      /information_schema\.tables/.test(norm) &&
      /ORDER BY table_name/.test(norm)
    ) {
      return {
        rows: [
          { name: "orders", type: "BASE TABLE" },
          { name: "order_summary", type: "VIEW" },
        ],
        rowsAffected: 0,
      };
    }
    if (
      /information_schema\.tables/.test(norm) &&
      /table_name = \?/.test(norm)
    ) {
      return { rows: [{ type: "BASE TABLE" }], rowsAffected: 0 };
    }
    if (/information_schema\.columns/.test(norm)) {
      return {
        rows: [
          {
            name: "id",
            type: "integer",
            nullable: 0,
            dflt: "nextval('orders_id_seq'::regclass)",
          },
          { name: "customer_id", type: "integer", nullable: 0, dflt: null },
          { name: "note", type: "text", nullable: 1, dflt: null },
        ],
        rowsAffected: 0,
      };
    }
    if (/constraint_type = 'PRIMARY KEY'/.test(norm)) {
      return { rows: [{ col: "id" }], rowsAffected: 0 };
    }
    if (/constraint_type = 'FOREIGN KEY'/.test(norm)) {
      return {
        rows: [{ col: "customer_id", ref_table: "customers", ref_col: "id" }],
        rowsAffected: 0,
      };
    }
    if (/pg_indexes/.test(norm)) {
      return {
        rows: [
          {
            name: "orders_pkey",
            def: "CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)",
          },
          {
            name: "orders_customer_idx",
            def: "CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id)",
          },
        ],
        rowsAffected: 0,
      };
    }
    if (/COUNT\(\*\)/.test(norm)) {
      return { rows: [{ c: 5 }], rowsAffected: 0 };
    }
    return { rows: [], rowsAffected: 0 };
  };

  return {
    getDbExec: () => ({ execute }),
    getDialect: () => "postgres",
    isPostgres: () => true,
  };
});

const { listTables, getTableSchema } = await import("./operations.js");

beforeEach(() => {
  executed = [];
});

describe("db-admin operations — Postgres dialect (mocked)", () => {
  it("listTables uses information_schema (never sqlite_master/PRAGMA) and parses tables + views", async () => {
    const { dialect, tables } = await listTables();
    expect(dialect).toBe("postgres");
    expect(tables).toEqual([
      { name: "orders", type: "table", rowCount: 5 },
      { name: "order_summary", type: "view", rowCount: null },
    ]);
    expect(executed.some((s) => /information_schema\.tables/.test(s))).toBe(
      true,
    );
    expect(executed.some((s) => /sqlite_master|PRAGMA/.test(s))).toBe(false);
  });

  it("getTableSchema parses columns/PK/FK/indexes + serial autoIncrement from information_schema/pg_*", async () => {
    const schema = await getTableSchema("orders");

    expect(schema.type).toBe("table");
    expect(schema.primaryKey).toEqual(["id"]);

    expect(schema.columns.find((c) => c.name === "id")).toMatchObject({
      type: "integer",
      nullable: false,
      pk: true,
      autoIncrement: true, // nextval(...) → serial
    });
    expect(schema.columns.find((c) => c.name === "note")).toMatchObject({
      nullable: true,
      pk: false,
    });

    expect(schema.foreignKeys).toEqual([
      { column: "customer_id", refTable: "customers", refColumn: "id" },
    ]);
    expect(schema.indexes).toEqual([
      { name: "orders_pkey", unique: true, columns: ["id"] },
      { name: "orders_customer_idx", unique: false, columns: ["customer_id"] },
    ]);

    expect(executed.some((s) => /information_schema\.columns/.test(s))).toBe(
      true,
    );
    expect(executed.some((s) => /PRAGMA/.test(s))).toBe(false);
  });
});
