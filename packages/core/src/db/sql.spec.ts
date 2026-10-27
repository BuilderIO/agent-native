import { describe, expect, it, vi } from "vitest";

import {
  getSqlFragmentParameterOffsets,
  sql,
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
