import { describe, expect, it, vi } from "vitest";

import {
  getSqlFragmentParameterOffsets,
  sql,
  withSqlBudget,
  type SqlFragment,
} from "./sql.js";

type AssertFalse<T extends false> = T;
export type RawStringsAreNotSqlInterpolations = AssertFalse<
  string extends Parameters<typeof sql>[1] ? true : false
>;

describe("sql", () => {
  it("binds values and composes nested fragments in order", () => {
    const id = "thread-1";
    const states = sql.in(["submitted", "working"]);
    const query = sql`SELECT ${sql.ident("id")} FROM chat_threads WHERE id = ${sql.value(id)} AND status IN ${states}`;

    expect(query.sql).toBe(
      'SELECT "id" FROM chat_threads WHERE id = ? AND status IN (?, ?)',
    );
    expect(query.args).toEqual([id, "submitted", "working"]);
  });

  it("preserves backslashes in raw SQL template text", () => {
    const query = sql`SELECT '\d+'`;

    expect(query.sql).toBe(String.raw`SELECT '\d+'`);
  });

  it("preserves doubled backslashes in raw SQL template text", () => {
    const query = sql`SELECT '\\'`;

    expect(query.sql).toBe(String.raw`SELECT '\\'`);
  });

  it("keeps fragment arguments immutable", () => {
    const query = sql`SELECT ${sql.value("thread-1")}`;

    expect(Object.isFrozen(query.args)).toBe(true);
  });

  it("composes fragments from a separately loaded package copy", async () => {
    vi.resetModules();
    const foreignSql = await import("./sql.js");
    const foreignPredicate = foreignSql.sql`WHERE id = ${foreignSql.sql.value("thread-1")}`;
    const query = sql`SELECT ${foreignSql.sql.ident("id")} FROM tasks ${foreignPredicate}`;

    expect(query.sql).toBe('SELECT "id" FROM tasks WHERE id = ?');
    expect(query.args).toEqual(["thread-1"]);
  });

  it("rejects malformed fragment marker metadata", () => {
    const malformed = Object.freeze({
      sql: "SELECT 1",
      args: Object.freeze(["thread-1"]),
      [Symbol.for("@agent-native/core/sql-fragment")]: true,
      [Symbol.for("@agent-native/core/sql-fragment-parameter-offsets")]: [0],
    }) as unknown as SqlFragment;

    expect(() => sql`SELECT * FROM tasks ${malformed}`).toThrow(
      "SQL interpolation must be a fragment, identifier, or bound value",
    );
  });

  it("tracks generated bind markers separately from PostgreSQL question operators", () => {
    const query = sql`SELECT payload ? 'key', payload ?| ARRAY['tag'], payload ?& ARRAY['tag'] FROM records WHERE id = ${sql.value("thread-1")}`;

    const offsets = getSqlFragmentParameterOffsets(query);
    expect(query.sql[offsets[0] ?? -1]).toBe("?");
    expect(offsets).toEqual([query.sql.lastIndexOf("?")]);
  });

  it("joins fragments with a fragment separator", () => {
    const query = sql`WHERE ${sql.join(
      [
        sql`owner_email = ${sql.value("owner@example.com")}`,
        sql`active = ${sql.value(true)}`,
      ],
      sql` AND `,
    )}`;

    expect(query.sql).toBe("WHERE owner_email = ? AND active = ?");
    expect(query.args).toEqual(["owner@example.com", true]);
  });

  it("rejects identifiers outside the lowercase SQL identifier grammar", () => {
    expect(() => sql.ident("User")).toThrow("Invalid SQL identifier");
    expect(() => sql.ident("users.id")).toThrow("Invalid SQL identifier");
    expect(() => sql.ident("users\n")).toThrow("Invalid SQL identifier");
    expect(() => sql.ident('users"; DROP TABLE users;--')).toThrow(
      "Invalid SQL identifier",
    );
  });

  it("quotes validated identifiers so reserved words remain valid", () => {
    const query = sql`SELECT ${sql.ident("select")} FROM records`;

    expect(query.sql).toBe('SELECT "select" FROM records');
  });

  it("rejects empty IN lists", () => {
    expect(() => sql.in([])).toThrow("SQL IN requires at least one value");
  });

  it("does not silently coerce undefined bound values to null", () => {
    expect(() => sql.value(undefined)).toThrow(
      "SQL bound values cannot be undefined",
    );
    expect(() => sql.in(["active", undefined])).toThrow(
      "SQL IN values cannot include undefined",
    );
  });

  it("rejects SQL helpers nested inside bound values and IN lists", () => {
    const fragment: unknown = sql`SELECT 1`;
    const identifier: unknown = sql.ident("id");
    const boundValue: unknown = sql.value("value");

    expect(() => sql.value(fragment)).toThrow(
      "SQL bound values cannot be SQL helpers",
    );
    expect(() => sql.value(identifier)).toThrow(
      "SQL bound values cannot be SQL helpers",
    );
    expect(() => sql.value(boundValue)).toThrow(
      "SQL bound values cannot be SQL helpers",
    );
    expect(() => sql.in([fragment])).toThrow(
      "SQL IN values cannot include SQL helpers",
    );
    expect(() => sql.in([identifier])).toThrow(
      "SQL IN values cannot include SQL helpers",
    );
    expect(() => sql.in([boundValue])).toThrow(
      "SQL IN values cannot include SQL helpers",
    );
  });
});

describe("withSqlBudget", () => {
  it("preserves branded SQL, arguments and exact marker offsets without mutating the input", () => {
    const nested = sql`payload ? 'key' AND id = ${sql.value("?")}`;
    const source = sql`SELECT '?' AS literal WHERE ${nested} AND other = ${sql.value(42)}`;
    const before = getSqlFragmentParameterOffsets(source);
    const options = { timeoutMs: 2500, maxAttempts: 1 };
    const budgeted = withSqlBudget(source, options);
    options.timeoutMs = 3000;
    expect(budgeted).not.toBe(source);
    expect(Object.isFrozen(budgeted)).toBe(true);
    expect(Object.isFrozen(budgeted.args)).toBe(true);
    expect(budgeted.sql).toBe(source.sql);
    expect(budgeted.args).toEqual(["?", 42]);
    expect(getSqlFragmentParameterOffsets(budgeted)).toEqual(before);
    const marker = Symbol.for(
      "@agent-native/core/sql-fragment-parameter-offsets",
    );
    expect(Reflect.get(budgeted, marker)).toEqual(Reflect.get(source, marker));
    expect(Object.isFrozen(Reflect.get(budgeted, marker))).toBe(true);
    expect("timeoutMs" in source).toBe(false);
    expect("maxAttempts" in source).toBe(false);
    expect(budgeted).toMatchObject({ timeoutMs: 2500, maxAttempts: 1 });
  });
  it.each([
    [0, 1],
    [-1, 1],
    [0.1, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [2_147_483_648, 1],
    [1, 0],
    [1, -1],
    [1, 1.5],
    [1, Number.NaN],
    [1, Number.POSITIVE_INFINITY],
    [1, 11],
  ])(
    "rejects invalid timeout %s or attempt count %s",
    (timeoutMs, maxAttempts) => {
      expect(() =>
        withSqlBudget(sql`SELECT 1`, { timeoutMs, maxAttempts }),
      ).toThrow(RangeError);
    },
  );
  it("rejects missing, non-numeric and malformed budgets at the runtime boundary", () => {
    const source = sql`SELECT 1`;
    for (const budget of [
      undefined,
      null,
      {},
      { timeoutMs: "25", maxAttempts: 1 },
    ]) {
      expect(() =>
        Reflect.apply(withSqlBudget, undefined, [source, budget]),
      ).toThrow(RangeError);
    }
  });
  it("rejects an unbranded query object", () => {
    expect(() =>
      Reflect.apply(withSqlBudget, undefined, [
        { sql: "SELECT ?", args: ["x"] },
        { timeoutMs: 25, maxAttempts: 1 },
      ]),
    ).toThrow(TypeError);
  });
  it("accepts boundary values and does not propagate nested execution budgets", async () => {
    vi.resetModules();
    const foreign = await import("./sql.js");
    const inner = foreign.withSqlBudget(
      foreign.sql`payload ? 'k' AND id = ${foreign.sql.value("?")}`,
      { timeoutMs: 1, maxAttempts: 10 },
    );
    const outer = sql`SELECT '?' WHERE ${inner}`;
    const joined = sql.join([inner], sql` AND `);
    expect("timeoutMs" in joined).toBe(false);
    expect(getSqlFragmentParameterOffsets(joined)).toEqual(
      getSqlFragmentParameterOffsets(inner),
    );
    const rewrapped = withSqlBudget(inner, { timeoutMs: 2, maxAttempts: 2 });
    expect(rewrapped.args).toEqual(inner.args);
    expect(getSqlFragmentParameterOffsets(rewrapped)).toEqual(
      getSqlFragmentParameterOffsets(inner),
    );
    expect(rewrapped).toMatchObject({ timeoutMs: 2, maxAttempts: 2 });
    expect("timeoutMs" in outer).toBe(false);
    expect("maxAttempts" in outer).toBe(false);
    expect(getSqlFragmentParameterOffsets(outer)).toEqual([
      outer.sql.lastIndexOf("?"),
    ]);
    expect(outer.args).toEqual(["?"]);
    const wrapped = withSqlBudget(outer, {
      timeoutMs: 2_147_483_647,
      maxAttempts: 1,
    });
    expect(wrapped).toMatchObject({ timeoutMs: 2_147_483_647, maxAttempts: 1 });
    expect(getSqlFragmentParameterOffsets(wrapped)).toEqual(
      getSqlFragmentParameterOffsets(outer),
    );
  });
});
