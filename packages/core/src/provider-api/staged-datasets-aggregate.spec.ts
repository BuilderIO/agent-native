/**
 * Tests for TypeScript in-process aggregation over staged dataset rows.
 *
 * Covers: groupBy + sum/avg/count/min/max, where filters, orderBy, limit,
 * count_distinct, and edge cases (empty rows, non-numeric values, multi-key groups).
 */

import { describe, expect, it } from "vitest";

import { runAggregateQuery } from "./staged-datasets-aggregate.js";

const SALES = [
  { region: "us", product: "pro", amount: 100, orders: 2 },
  { region: "us", product: "free", amount: 0, orders: 5 },
  { region: "eu", product: "pro", amount: 200, orders: 3 },
  { region: "eu", product: "enterprise", amount: 500, orders: 1 },
  { region: "apac", product: "pro", amount: 150, orders: 4 },
];

describe("runAggregateQuery — groupBy + sum/count", () => {
  it("sums amount by region", () => {
    const result = runAggregateQuery(SALES, {
      groupBy: ["region"],
      aggregate: [
        { column: "amount", op: "sum", as: "total_amount" },
        { column: "orders", op: "count", as: "n" },
      ],
      orderBy: "total_amount",
      orderDir: "desc",
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ region: "eu", total_amount: 700 });
    expect(result[1]).toMatchObject({ region: "apac", total_amount: 150 });
    expect(result[2]).toMatchObject({ region: "us", total_amount: 100 });
  });

  it("counts rows per group", () => {
    const result = runAggregateQuery(SALES, {
      groupBy: ["region"],
      aggregate: [{ column: "amount", op: "count", as: "row_count" }],
    });
    const us = result.find((r) => r.region === "us");
    expect(us?.row_count).toBe(2);
  });

  it("computes avg correctly", () => {
    const result = runAggregateQuery(SALES, {
      groupBy: ["product"],
      aggregate: [{ column: "amount", op: "avg", as: "avg_amount" }],
    });
    const pro = result.find((r) => r.product === "pro");
    // (100 + 200 + 150) / 3 = 150
    expect(pro?.avg_amount).toBeCloseTo(150, 5);
  });

  it("computes min and max", () => {
    const result = runAggregateQuery(SALES, {
      aggregate: [
        { column: "amount", op: "min", as: "min_amount" },
        { column: "amount", op: "max", as: "max_amount" },
      ],
    });
    expect(result[0]?.min_amount).toBe(0);
    expect(result[0]?.max_amount).toBe(500);
  });

  it("computes count_distinct", () => {
    const result = runAggregateQuery(SALES, {
      aggregate: [
        { column: "product", op: "count_distinct", as: "distinct_products" },
      ],
    });
    expect(result[0]?.distinct_products).toBe(3); // pro, free, enterprise
  });

  it("handles multi-column groupBy", () => {
    const result = runAggregateQuery(SALES, {
      groupBy: ["region", "product"],
      aggregate: [{ column: "amount", op: "sum", as: "total" }],
    });
    const euPro = result.find((r) => r.region === "eu" && r.product === "pro");
    expect(euPro?.total).toBe(200);
  });
});

describe("runAggregateQuery — where filters", () => {
  it("filters with equals", () => {
    const result = runAggregateQuery(SALES, {
      where: [{ column: "region", op: "equals", value: "us" }],
    });
    expect(result).toHaveLength(2);
  });

  it("filters with not_equals", () => {
    const result = runAggregateQuery(SALES, {
      where: [{ column: "region", op: "not_equals", value: "us" }],
    });
    expect(result).toHaveLength(3);
  });

  it("filters with gt", () => {
    const result = runAggregateQuery(SALES, {
      where: [{ column: "amount", op: "gt", value: 100 }],
    });
    expect(result.every((r) => Number(r.amount) > 100)).toBe(true);
  });

  it("filters with contains (case-insensitive)", () => {
    const texts = [
      { msg: "Hello World" },
      { msg: "foo bar" },
      { msg: "HELLO" },
    ];
    const result = runAggregateQuery(texts, {
      where: [{ column: "msg", op: "contains", value: "hello" }],
    });
    expect(result).toHaveLength(2);
  });

  it("chains multiple where clauses (AND)", () => {
    const result = runAggregateQuery(SALES, {
      where: [
        { column: "region", op: "equals", value: "eu" },
        { column: "amount", op: "gte", value: 400 },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.product).toBe("enterprise");
  });

  it("exists / not_exists", () => {
    const rows = [
      { name: "Alice", score: 5 },
      { name: "Bob", score: null },
      { name: "Carol" },
    ];
    const withScore = runAggregateQuery(rows, {
      where: [{ column: "score", op: "exists" }],
    });
    expect(withScore).toHaveLength(1);
    expect(withScore[0]?.name).toBe("Alice");

    const withoutScore = runAggregateQuery(rows, {
      where: [{ column: "score", op: "not_exists" }],
    });
    expect(withoutScore).toHaveLength(2);
  });
});

describe("runAggregateQuery — select projection", () => {
  it("projects columns when no aggregate specified", () => {
    const result = runAggregateQuery(SALES, {
      select: ["region", "amount"],
    });
    expect(Object.keys(result[0]!)).toEqual(["region", "amount"]);
  });
});

describe("runAggregateQuery — orderBy + limit", () => {
  it("sorts ascending", () => {
    const result = runAggregateQuery(SALES, {
      orderBy: "amount",
      orderDir: "asc",
    });
    expect(result[0]?.amount).toBe(0);
    expect(result[result.length - 1]?.amount).toBe(500);
  });

  it("sorts descending", () => {
    const result = runAggregateQuery(SALES, {
      orderBy: "amount",
      orderDir: "desc",
    });
    expect(result[0]?.amount).toBe(500);
  });

  it("limits output rows", () => {
    const result = runAggregateQuery(SALES, {
      orderBy: "amount",
      orderDir: "desc",
      limit: 2,
    });
    expect(result).toHaveLength(2);
  });
});

describe("runAggregateQuery — edge cases", () => {
  it("returns empty array for empty input", () => {
    expect(
      runAggregateQuery([], { aggregate: [{ column: "x", op: "sum" }] }),
    ).toEqual([]);
  });

  it("handles non-numeric values in sum gracefully (treats as 0)", () => {
    const rows = [{ v: "abc" }, { v: "10" }, { v: null }];
    const result = runAggregateQuery(rows, {
      aggregate: [{ column: "v", op: "sum", as: "total" }],
    });
    expect(result[0]?.total).toBe(10);
  });
});
