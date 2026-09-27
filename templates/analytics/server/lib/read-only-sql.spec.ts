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
    "DELETE FROM `project.dataset.table`",
    "WITH rows AS (SELECT 1) UPDATE target SET value = 2",
    "SELECT 1; DELETE FROM target",
    "SELECT value INTO target FROM source",
  ])("rejects mutating or multi-statement SQL: %s", (sql) => {
    expect(() => assertReadOnlySql(sql)).toThrow();
  });

  it("rejects BigQuery backslash escapes before they can hide another statement", () => {
    expect(() =>
      assertReadOnlySql(
        String.raw`SELECT 'it\'s'; DELETE FROM target`,
        "bigquery",
      ),
    ).toThrow(/escapes are not supported/);
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
