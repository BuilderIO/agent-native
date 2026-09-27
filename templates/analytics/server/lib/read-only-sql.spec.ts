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
});
