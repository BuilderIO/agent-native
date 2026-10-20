import { describe, expect, it } from "vitest";

import { assertReadOnlySql } from "./read-only-sql";

describe("assertReadOnlySql", () => {
  it("allows read-only SQL with mutation words in comments and literals", () => {
    expect(() =>
      assertReadOnlySql(
        "SELECT 'delete; update' AS note /* DROP TABLE */ FROM `project.dataset.table`",
      ),
    ).not.toThrow();
  });

  it.each([
    ["SELECT customer1delete FROM source", "bigquery"],
    ["SELECT update2_count FROM source", "bigquery"],
    ["SELECT value$merge FROM source", "standard"],
  ] as const)(
    "allows mutation words inside identifiers: %s",
    (sql, dialect) => {
      expect(() => assertReadOnlySql(sql, dialect)).not.toThrow();
    },
  );

  it.each([
    "DELETE FROM `project.dataset.table`",
    "WITH rows AS (SELECT 1) UPDATE target SET value = 2",
    "SELECT 1; DELETE FROM target",
    "SELECT value INTO target FROM source",
  ])("rejects mutating or multi-statement SQL: %s", (sql) => {
    expect(() => assertReadOnlySql(sql)).toThrow();
  });

  it.each([
    String.raw`SELECT 'it\'s' AS note FROM source`,
    String.raw`SELECT REGEXP_CONTAINS(value, '\\d+') FROM source`,
    String.raw`SELECT REGEXP_REPLACE(value, '\\s+', ' ') FROM source`,
    String.raw`SELECT "a\"; DELETE" AS note`,
  ])("allows BigQuery backslash escapes inside strings: %s", (sql) => {
    expect(() => assertReadOnlySql(sql, "bigquery")).not.toThrow();
  });

  it.each([
    String.raw`SELECT 'it\'s'; DELETE FROM target`,
    String.raw`SELECT 'a\\'; DELETE FROM target`,
  ])("still finds a statement after an escaped string: %s", (sql) => {
    expect(() => assertReadOnlySql(sql, "bigquery")).toThrow(
      /single statement/,
    );
  });

  it.each([
    "SELECT 1 # '\n; DELETE FROM t WHERE true; --'",
    "SELECT 1 #\n; DELETE FROM t",
    String.raw`SELECT r'\', '; DELETE FROM t WHERE true; --'`,
    String.raw`SELECT R"\", "; DELETE FROM t WHERE true; --"`,
  ])("lexes # comments and raw strings as BigQuery does: %s", (sql) => {
    expect(() => assertReadOnlySql(sql, "bigquery")).toThrow(
      /single statement/,
    );
  });

  it("ignores mutation words in a BigQuery # comment", () => {
    expect(() =>
      assertReadOnlySql(
        "SELECT 1 AS n # DELETE everything\nFROM t",
        "bigquery",
      ),
    ).not.toThrow();
  });

  it("rejects a BigQuery string that ends in an escape", () => {
    expect(() =>
      assertReadOnlySql(String.raw`SELECT 'abc\'`, "bigquery"),
    ).toThrow(/unterminated/);
  });

  it.each([
    "SELECT REPLACE(name, 'a', 'b') AS name FROM source",
    "SELECT * REPLACE (UPPER(name) AS name) FROM source",
    "SELECT * replace(1 AS id) FROM source",
  ])("allows the REPLACE function and SELECT * REPLACE: %s", (sql) => {
    expect(() => assertReadOnlySql(sql, "bigquery")).not.toThrow();
  });

  it.each([
    "WITH t AS (SELECT 1) REPLACE INTO target SELECT * FROM t",
    "WITH t AS (SELECT 1) REPLACE target SELECT * FROM t",
    "WITH t AS (SELECT 1) CREATE OR REPLACE TABLE target AS SELECT 1",
  ])("still rejects REPLACE statements: %s", (sql) => {
    expect(() => assertReadOnlySql(sql, "bigquery")).toThrow();
  });

  it("inspects BigQuery triple-quoted string contents without treating them as SQL", () => {
    expect(() =>
      assertReadOnlySql(`SELECT '''delete; update''' AS note`, "bigquery"),
    ).not.toThrow();
    expect(() =>
      assertReadOnlySql(`SELECT '''safe'''; DELETE FROM target`, "bigquery"),
    ).toThrow();
  });

  it("allows backslashes in BigQuery raw strings without hiding trailing SQL", () => {
    expect(() =>
      assertReadOnlySql(
        String.raw`SELECT REGEXP_CONTAINS(value, r'\d+') FROM source`,
        "bigquery",
      ),
    ).not.toThrow();
    expect(() =>
      assertReadOnlySql(String.raw`SELECT R'''\d+; DELETE'''`, "bigquery"),
    ).not.toThrow();
    expect(() =>
      assertReadOnlySql(
        String.raw`SELECT REGEXP_CONTAINS(value, r'\d+'); DELETE FROM target`,
        "bigquery",
      ),
    ).toThrow(/single statement/);
  });
});
