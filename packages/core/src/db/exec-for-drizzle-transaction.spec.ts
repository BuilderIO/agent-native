import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { execForDrizzleTransaction } from "./exec-for-drizzle-transaction.js";

describe("execForDrizzleTransaction", () => {
  it("normalizes question-mark placeholders and preserves bound arguments through Drizzle", async () => {
    const execute = vi.fn(async (_query: SQL) => ({
      rows: [{ value: "bound" }],
      rowCount: 1,
    }));
    const transaction = execForDrizzleTransaction({ execute });
    const args = ["? $1 'quoted'", 42];
    expect(
      await transaction.execute({
        sql: "SELECT ? AS value, ? AS number, '?' AS literal",
        args,
      }),
    ).toEqual({ rows: [{ value: "bound" }], rowsAffected: 1 });
    expect(new PgDialect().sqlToQuery(execute.mock.calls[0]![0])).toEqual({
      sql: "SELECT $1 AS value, $2 AS number, '?' AS literal",
      params: args,
    });
  });

  it("executes string statements without bindings", async () => {
    const execute = vi.fn(async (_query: SQL) => ({ rows: [] }));
    await execForDrizzleTransaction({ execute }).execute("SELECT 1");
    expect(new PgDialect().sqlToQuery(execute.mock.calls[0]![0])).toEqual({
      sql: "SELECT 1",
      params: [],
    });
  });

  it.each([
    ["postgres-js", Object.assign([{ id: "row" }], { count: 3 }), 3],
    ["node-postgres/Neon", { rows: [{ id: "row" }], rowCount: 2 }, 2],
    ["PGlite", { rows: [{ id: "row" }], affectedRows: 4 }, 4],
    ["rows without count", [{ id: "row" }], 1],
    ["empty rows without count", { rows: [] }, 0],
    ["empty mutation result", { rows: [], rowCount: 5 }, 5],
    ["explicit zero count", { rows: [{ id: "row" }], rowCount: 0 }, 0],
  ])(
    "preserves rows and affected counts for %s",
    async (_name, result, count) => {
      const exec = execForDrizzleTransaction({ execute: async () => result });
      expect(await exec.execute("SELECT 1")).toEqual({
        rows: Array.isArray(result) ? result : result.rows,
        rowsAffected: count,
      });
    },
  );

  it("rejects a result without a row array instead of reporting success", async () => {
    const exec = execForDrizzleTransaction({
      execute: async () => ({ rowCount: 1 }),
    });
    await expect(exec.execute("SELECT 1")).rejects.toThrow(
      "Transaction access query returned no row array",
    );
  });
});
