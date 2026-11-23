import { tableFromIPC, tableToIPC } from "apache-arrow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { notebookArrowRows } from "./notebook-arrow.js";
import { openPglitePostgresFixture } from "./postgres-connector-test-fixture.js";
import {
  createPostgresSessionConnector,
  postgresTableQuery,
} from "./postgres-connector.js";
import { WarehouseExecutionError } from "./sql-adapter.js";
import type { CompiledSql } from "./sql-compiler.js";

const typedQuery: CompiledSql = {
  sql: `select sentinel, cast($1 as numeric) as precise, cast($2 as timestamptz) as at,
    cast($3 as text) as missing from "phase_east"."same.name"`,
  parameters: [
    {
      name: "decimal",
      parameterType: { type: "NUMERIC" },
      parameterValue: { value: "123456789012345678.000000000000000001" },
    },
    {
      name: "timestamp",
      parameterType: { type: "TIMESTAMP" },
      parameterValue: { value: "2025-05-06T07:08:09.123456-03:30" },
    },
    {
      name: "empty",
      parameterType: { type: "STRING" },
      parameterValue: { value: null },
    },
  ],
};

let fixture: Awaited<ReturnType<typeof openPglitePostgresFixture>>;
const allowed = () => {};
const submitted = (sql: string) => ({ sql, parameters: [] });

beforeAll(async () => {
  fixture = await openPglitePostgresFixture();
});
afterAll(async () => {
  await fixture.db.close();
});

describe("PostgreSQL read-only warehouse connector", () => {
  it("qualifies limit-100 queries and keeps same-named tables distinct", async () => {
    const connection = createPostgresSessionConnector(fixture.open, allowed);
    await expect(connection.validate()).resolves.toEqual({ checkedSchemas: 3 });
    await expect(connection.catalog()).resolves.toEqual({
      schemas: ["phase_east", "phase_west", "public"],
      tables: [],
      columns: [],
    });
    const [west, east] = [
      await connection.catalog({ schema: "phase_west", table: "same.name" }),
      await connection.catalog({ schema: "phase_east", table: "same.name" }),
    ];
    expect(west.tables[0]).toMatchObject({
      schema: "phase_west",
      name: "same.name",
    });
    expect(east.tables[0]).toMatchObject({
      schema: "phase_east",
      name: "same.name",
    });
    expect(west.tables[0]?.oid).not.toBe(east.tables[0]?.oid);
    expect(west.columns).toEqual([
      {
        name: "sentinel",
        type: "bigint",
        nullable: false,
        description: "West sentinel",
      },
    ]);
    const sql = postgresTableQuery("phase_west", "same.name");
    expect(sql).toBe('select * from "phase_west"."same.name" limit 100');
    const cursor = await connection.submit(submitted(sql));
    const done = await cursor.page(50);
    expect({ cursor: done.cursor, complete: done.complete }).toEqual({
      cursor: null,
      complete: true,
    });
    expect(notebookArrowRows(done.table, done.fields).rows).toEqual([[84n]]);
  });

  it("round-trips exact bound numerics, zoned microseconds and explicit NULL across Arrow pages", async () => {
    const connection = createPostgresSessionConnector(fixture.open, allowed);
    const cursor = await connection.submit(typedQuery);
    const first = await cursor.page(1);
    const ending = await cursor.page(1);
    expect(first.complete).toBe(false);
    expect(first.cursor).toMatch(/:1$/);
    expect(first.fields.map(({ type }) => type)).toEqual([
      "integer",
      "decimal",
      "datetime",
      "string",
    ]);
    const table = tableFromIPC(tableToIPC(first.table));
    expect(notebookArrowRows(table, first.fields).rows).toEqual([
      [
        42n,
        "123456789012345678.000000000000000001",
        "2025-05-06T10:38:09.123456Z",
        null,
      ],
    ]);
    expect(ending.cursor).toBeNull();
    expect(ending.complete).toBe(true);
    expect(ending.table.numRows).toBe(0);
    expect(ending.fields).toEqual(first.fields);
    expect(ending.table.schema.fields).toEqual(first.table.schema.fields);
  });

  it("denies a revoked read and closes its cursor without attempting recovery", async () => {
    let authorized = true;
    const connection = createPostgresSessionConnector(fixture.open, () => {
      if (!authorized)
        throw new WarehouseExecutionError("source_access_denied");
    });
    const cursor = await connection.submit(typedQuery);
    expect((await cursor.page(1)).complete).toBe(false);
    authorized = false;
    await expect(cursor.page(1)).rejects.toThrow("source_access_denied");
    await expect(connection.submit(typedQuery)).rejects.toThrow(
      "source_access_denied",
    );
    await expect(
      fixture.db.query(
        "select name from pg_cursors where name = 'analytics_result'",
      ),
    ).resolves.toMatchObject({ rows: [] });
    await expect(connection.recover()).rejects.toThrow("source_access_denied");
    authorized = true;
    await expect(connection.recover()).rejects.toThrow("postgres_cursor_lost");
  });

  it("closes a cancelled cursor and rejects a role with write privileges at Test", async () => {
    const connection = createPostgresSessionConnector(fixture.open, allowed);
    const cursor = await connection.submit(typedQuery);
    const first = await cursor.page(1);
    expect(first.complete).toBe(false);
    await cursor.cancel();
    await expect(
      fixture.db.query(
        "select name from pg_cursors where name = 'analytics_result'",
      ),
    ).resolves.toMatchObject({ rows: [] });
    await expect(cursor.page(1)).rejects.toThrow("postgres_cursor_lost");
    await fixture.db.exec(
      'grant update on phase_east."same.name" to analytics_warehouse_reader',
    );
    try {
      await expect(connection.validate()).rejects.toThrow(
        "warehouse_read_only_role_required",
      );
    } finally {
      await fixture.db.exec(
        'revoke update on phase_east."same.name" from analytics_warehouse_reader',
      );
    }
  });
});
