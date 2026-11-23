import { describe, expect, it } from "vitest";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import { organizationWarehouseQueryInputSchema } from "../../shared/organization-warehouse-query-contract.js";
import { requireOrganizationReadOnlySql } from "./organization-warehouse-query.js";

describe("organization warehouse query input boundary", () => {
  it("accepts an exact source start and rejects provider continuation identities", () => {
    expect(
      organizationWarehouseQueryInputSchema.parse({
        operation: "start",
        connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
        sql: "SELECT 1",
      }),
    ).toMatchObject({ maxRows: 1000 });
    expect(
      organizationWarehouseQueryInputSchema.safeParse({
        operation: "poll",
        queryId: "opaque",
        jobId: "job",
      }).success,
    ).toBe(false);
  });
  it.each([
    "DELETE FROM x",
    "SELECT 1; DELETE FROM x",
    "WITH x AS (SELECT 1) DELETE FROM x",
    "SELECT 'unterminated",
    "SELECT (1",
    "WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x",
  ])("rejects unsafe SQL %s", (sql) => {
    expect(() => requireOrganizationReadOnlySql(sql)).toThrow();
  });
  it.each([
    "SELECT ';delete'",
    "-- write\nWITH x AS (SELECT 1) SELECT * FROM x",
    "SELECT ''';drop'''",
    "SELECT `delete` FROM `project.data.table`",
    "SELECT 1 /* ; UPDATE */",
    "SELECT 'it\\'s fine'",
  ])("accepts one quoted/commented SELECT %s", (sql) => {
    expect(requireOrganizationReadOnlySql(sql)).toBe(sql.trim());
  });
  it.each([
    "SELECT update, t.delete, t.drop FROM warehouse AS t",
    "SELECT (update) FROM warehouse",
    "WITH update AS (SELECT 1 AS call) SELECT call FROM update",
    "WITH `drop` AS (SELECT 1 AS `update`) SELECT `update` FROM `drop`",
    "WITH RECURSIVE update AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM update WHERE n < 3) SELECT * FROM update",
    "(SELECT 1) UNION ALL (SELECT 2)",
    "WITH a AS ((SELECT 1) UNION ALL SELECT 2), drop AS (WITH b AS (SELECT 3) SELECT * FROM b) SELECT * FROM drop",
    "SELECT 1;",
    "SELECT ';' AS marker; -- trailing comment",
    "WITH update AS (SELECT 1) SELECT * FROM update; /* ; harmless */",
    "(SELECT 1) UNION ALL SELECT 2; # trailing comment; ignored",
    "WITH `with` AS (SELECT 1 AS `delete`) SELECT `delete` FROM `with`;",
  ])(
    "accepts a read query head with contextual identifiers and one optional terminator: %s",
    (sql) => {
      expect(requireOrganizationReadOnlySql(sql)).toBe(sql.trim());
    },
  );
  it.each([
    "WITH c AS (SELECT 1) INSERT INTO dst SELECT * FROM c",
    "WITH a AS (WITH b AS (DELETE FROM x) SELECT * FROM b) SELECT * FROM a",
    "WITH c AS ((DELETE FROM x)) SELECT * FROM c",
    "WITH c AS (SELECT 1), d AS (UPDATE x SET y = 2) SELECT * FROM c",
    "WITH c SELECT 1 SELECT * FROM c",
    "WITH c AS SELECT 1 SELECT * FROM c",
    "WITH 'literal' AS (SELECT 1) SELECT 1",
    "WITH c AS (SELECT 1) SELECT 1; SELECT 2",
    "WITH c AS (SELECT 1;) SELECT 1",
    "SELECT 1;;",
    "SELECT 1; /* unterminated",
    "WITH c AS (SELECT 1), SELECT 1",
    "WITH c AS (SELECT 1) WITH d AS (SELECT 2) SELECT 1",
    "WITH c AS ((SELECT 1);) SELECT 1",
    "WITH c AS (SELECT 1) (INSERT INTO dst SELECT * FROM c)",
    "WITH c AS (WITH d AS (SELECT 1) INSERT INTO dst SELECT 1) SELECT * FROM c",
  ])(
    "rejects a write head, ambiguous CTE header, or multiple/interior terminator: %s",
    (sql) => {
      expect(() => requireOrganizationReadOnlySql(sql)).toThrow();
    },
  );
  it("bounds recursive query-head parsing without rejecting ordinary nested read CTEs", () => {
    const nested = (levels: number) => {
      let query = "SELECT 1";
      for (let i = 0; i < levels; i++)
        query = `WITH c${i} AS (${query}) SELECT * FROM c${i}`;
      return query;
    };
    expect(requireOrganizationReadOnlySql(nested(8))).toBe(nested(8));
    expect(() => requireOrganizationReadOnlySql(nested(40))).toThrow();
  });
  it.each(["SELECT 1; 'literal'", "SELECT 1; `identifier`", "SELECT 1; ()"])(
    "rejects significant trailing tokens after a terminator: %s",
    (sql) => {
      expect(() => requireOrganizationReadOnlySql(sql)).toThrow();
    },
  );
});
