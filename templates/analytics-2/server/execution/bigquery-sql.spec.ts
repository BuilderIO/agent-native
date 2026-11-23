import { describe, expect, it } from "vitest";

import { readBigQuerySources } from "./bigquery-sql";

const fn =
  "`builder-3b0a2.analytics.first_party_analytics_events_raw_query_range`";

describe("readBigQuerySources table functions", () => {
  it("reads the allow-listed range function as its dataset source", () => {
    expect(
      readBigQuerySources(
        `select a from ${fn}(CASE WHEN 1 = 1 THEN DATE '1970-01-01' END, CURRENT_DATE()) e`,
      ),
    ).toEqual([{ qualifiers: ["builder-3b0a2", "analytics"], cte: false }]);
  });

  it("reads every call of the allow-listed range function", () => {
    expect(
      readBigQuerySources(
        `select a from ${fn}(1, 2) e join ${fn}(3, 4) f on true`,
      ),
    ).toEqual([
      { qualifiers: ["builder-3b0a2", "analytics"], cte: false },
      { qualifiers: ["builder-3b0a2", "analytics"], cte: false },
    ]);
  });

  it("rejects other table functions and queries in the arguments", () => {
    expect(() => readBigQuerySources("select a from `p.d.fn`(1)")).toThrow();
    expect(() =>
      readBigQuerySources(`select a from ${fn}((select 1))`),
    ).toThrow();
  });
});

describe("readBigQuerySources from-clause syntax", () => {
  const dataset = [{ qualifiers: ["p", "d"], cte: false }];

  it("reads the source under a PIVOT", () => {
    expect(
      readBigQuerySources(
        "select * from (select product, quarter, sales from `p.d.s`) pivot(sum(sales) for quarter in ('Q1','Q2'))",
      ),
    ).toEqual(dataset);
  });

  it("reads the source under an UNPIVOT", () => {
    expect(
      readBigQuerySources(
        "select * from `p.d.s` unpivot(sales for quarter in (q1, q2))",
      ),
    ).toEqual(dataset);
    expect(
      readBigQuerySources(
        "select * from `p.d.s` unpivot exclude nulls (sales for quarter in (q1, q2)) u",
      ),
    ).toEqual(dataset);
    expect(
      readBigQuerySources(
        "select * from `p.d.s` unpivot include nulls (sales for quarter in (q1, q2)) u",
      ),
    ).toEqual(dataset);
  });

  it("reads the source beside UNNEST WITH OFFSET", () => {
    expect(
      readBigQuerySources(
        "select x, off from `p.d.t`, unnest(arr) as x with offset as off",
      ),
    ).toEqual(dataset);
  });

  it("reads a qualified wildcard table as its dataset", () => {
    expect(
      readBigQuerySources(
        "select count(*) from `p.d.events_*` where _table_suffix between '20260101' and '20260131'",
      ),
    ).toEqual(dataset);
    expect(readBigQuerySources("select * from `p.d`.`events_*`")).toEqual(
      dataset,
    );
    expect(() => readBigQuerySources("select * from `events_*`")).toThrow();
    expect(() => readBigQuerySources("select * from `p.d.ev*ents`")).toThrow();
  });

  it("reads the source under a TABLESAMPLE", () => {
    expect(
      readBigQuerySources(
        "select * from `p.d.t` tablesample system (10 percent)",
      ),
    ).toEqual(dataset);
  });

  it("reads queries inside PIVOT and TABLESAMPLE arguments as sources", () => {
    expect(
      readBigQuerySources(
        "select * from `p.d.t` pivot(sum((select max(x) from `p.h.s`)) for q in ('a')) as v",
      ),
    ).toEqual([...dataset, { qualifiers: ["p", "h"], cte: false }]);
    expect(
      readBigQuerySources(
        "select * from `p.d.t` tablesample system ((select 1 from `p.h.s`) percent)",
      ),
    ).toEqual([...dataset, { qualifiers: ["p", "h"], cte: false }]);
  });

  it("keeps rejecting extra statements, DML, CTEs named offset and ML table functions", () => {
    expect(() =>
      readBigQuerySources(
        "select * from `p.d.t` pivot(sum(x) for y in (1)); select 1",
      ),
    ).toThrow();
    expect(() =>
      readBigQuerySources("delete from `p.d.t` where true"),
    ).toThrow();
    expect(() =>
      readBigQuerySources("with offset as (select 1) select * from offset"),
    ).toThrow();
    expect(() =>
      readBigQuerySources(
        "select * from ml.predict(model `p.d.m`, (select * from `p.d.t` tablesample system (1 percent)))",
      ),
    ).toThrow();
  });
});
