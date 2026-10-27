import { describe, expect, it } from "vitest";

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
      "SELECT id FROM chat_threads WHERE id = ? AND status IN (?, ?)",
    );
    expect(query.args).toEqual([id, "submitted", "working"]);
  });

  it("keeps fragment arguments immutable", () => {
    const query = sql`SELECT ${sql.value("thread-1")}`;

    expect(Object.isFrozen(query.args)).toBe(true);
  });

  it("composes fragments from a second package instance", () => {
    const foreignFragment = Object.freeze({
      sql: "WHERE id = ?",
      args: Object.freeze(["thread-1"]),
      [Symbol.for("@agent-native/core/sql-fragment")]: true,
      [Symbol.for("@agent-native/core/sql-fragment-parameter-offsets")]: [11],
    }) as unknown as SqlFragment;

    const query = sql`SELECT * FROM tasks ${foreignFragment}`;

    expect(query.sql).toBe("SELECT * FROM tasks WHERE id = ?");
    expect(query.args).toEqual(["thread-1"]);
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
});
