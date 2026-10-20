import { describe, expect, it } from "vitest";

import { interpolateDashboardPanelSql } from "../../app/pages/adhoc/sql-dashboard/interpolate";
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

  it("inspects statements after escaped BigQuery literals", () => {
    expect(() =>
      assertReadOnlySql(
        String.raw`SELECT 'it\'s'; DELETE FROM target`,
        "bigquery",
      ),
    ).toThrow(/single statement/);
  });

  it.each([
    "O'Brien",
    String.raw`folder\file`,
    "quote'; DELETE FROM target --",
    '"quoted"',
    "line\nvalue",
  ])("accepts safely interpolated BigQuery click values: %s", (drillX) => {
    const sql = interpolateDashboardPanelSql(
      "SELECT '{{drillX}}' AS value",
      { drillX },
      { source: "bigquery" },
    );
    expect(() => assertReadOnlySql(sql, "bigquery")).not.toThrow();
    expect(() =>
      assertReadOnlySql(`${sql}; DELETE FROM target`, "bigquery"),
    ).toThrow(/single statement/);
  });

  it.each([
    String.raw`SELECT 'ends in \\'; DELETE FROM target`,
    String.raw`SELECT "it\"s"; DELETE FROM target`,
    String.raw`SELECT '''it\'s'''; DELETE FROM target`,
    String.raw`SELECT 'not closed\'`,
    "SELECT 'unfinished\\",
  ])("rejects trailing statements and incomplete literals: %s", (sql) => {
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
