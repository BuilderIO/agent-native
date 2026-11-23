import { expect, it } from "vitest";

import { sqlDataframeReferences } from "./sql-dataframe-references";

it("treats differently cased quoted and bare DuckDB CTE names as one scope", () => {
  expect(
    sqlDataframeReferences(
      'with "Frame" as (select * from upstream) select * from frame',
      {
        unqualifiedOnly: true,
        dialect: "duckdb",
      },
    ),
  ).toEqual(new Set(["upstream"]));
});

it("finds tables in joined, comma-separated and nested relations while honoring CTE scope", () => {
  expect(
    sqlDataframeReferences(`
    WITH scoped AS (SELECT * FROM scoped, public.date)
    SELECT * FROM scoped
    JOIN (SELECT * FROM "Mixed", THIRD) t ON true
    WHERE EXISTS (WITH third AS (SELECT * FROM fourth) SELECT * FROM third)
  `),
  ).toEqual(new Set(["scoped", "date", "Mixed", "third", "fourth"]));
});

it("ignores comments, literals, expressions and relations outside the dataframe schema", () => {
  expect(
    sqlDataframeReferences(`
    SELECT extract(year FROM column_name), 'JOIN hidden', a IS DISTINCT FROM b
    FROM frame, generate_series(1, 2) /* JOIN also_hidden */
    JOIN foreign_table.frame ON true
    WHERE a IS NOT DISTINCT FROM c AND EXISTS (SELECT * FROM public."Result")
  `),
  ).toEqual(new Set(["frame", "Result"]));
});
