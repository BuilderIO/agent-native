import { describe, expect, it } from "vitest";

import {
  aggregateSampleTable,
  formatMetricValue,
  previewSampleTable,
  sampleTable,
  sampleTables,
  seededRandom,
  withMonthColumn,
} from "./sample-data.js";

describe("sample data", () => {
  it("produces the same rows every time it is generated", () => {
    const first = sampleTables();
    const second = sampleTables();
    expect(first).toEqual(second);
    expect(first.map((table) => table.name)).toEqual([
      "orders",
      "customers",
      "products",
      "sessions",
      "support_tickets",
    ]);
    const orders = sampleTable("orders");
    expect(orders?.rows).toHaveLength(240);
    expect(orders?.rows[0]).toEqual(second[0]?.rows[0]);
  });

  it("keeps row values inside the column types", () => {
    for (const table of sampleTables()) {
      for (const row of table.rows) {
        expect(row).toHaveLength(table.columns.length);
        table.columns.forEach((column, index) => {
          const value = row[index];
          if (column.type === "number") expect(typeof value).toBe("number");
          if (column.type === "string") expect(typeof value).toBe("string");
          if (column.type === "date") {
            expect(typeof value).toBe("string");
            expect(value as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          }
        });
      }
    }
  });

  it("builds a generator that repeats for the same seed", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const draws = Array.from({ length: 8 }, () => [a(), b()]);
    for (const [left, right] of draws) {
      expect(left).toBe(right);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThan(1);
    }
  });

  it("aggregates a measure per group in first-seen order", () => {
    const orders = sampleTable("orders");
    if (orders === null) throw new Error("orders sample is missing");
    const grouped = aggregateSampleTable(orders, {
      groupBy: "channel",
      measure: "order_total",
      aggregation: "sum",
    });
    expect(grouped.columns.map((column) => column.name)).toEqual([
      "channel",
      "sum_order_total",
    ]);
    const firstSeen = [...new Set(orders.rows.map((row) => String(row[7])))];
    expect(grouped.rows.map((row) => row[0])).toEqual(firstSeen);
    const total = grouped.rows.reduce(
      (sum, row) => sum + (row[1] as number),
      0,
    );
    const expected = orders.rows.reduce(
      (sum, row) => sum + (row[6] as number),
      0,
    );
    expect(Math.round(total * 100) / 100).toBe(
      Math.round(expected * 100) / 100,
    );
  });

  it("counts groups and limits them without reordering", () => {
    const customers = sampleTable("customers");
    if (customers === null) throw new Error("customers sample is missing");
    const counted = aggregateSampleTable(customers, {
      groupBy: "segment",
      aggregation: "count",
    });
    expect(counted.columns.map((column) => column.name)).toEqual([
      "segment",
      "count",
    ]);
    const total = counted.rows.reduce(
      (sum, row) => sum + (row[1] as number),
      0,
    );
    expect(total).toBe(customers.rows.length);

    const limited = aggregateSampleTable(customers, {
      groupBy: "country",
      aggregation: "count",
      limit: 2,
    });
    expect(limited.rows).toHaveLength(2);
  });

  it("derives a month column from a date column", () => {
    const orders = sampleTable("orders");
    if (orders === null) throw new Error("orders sample is missing");
    const withMonth = withMonthColumn(orders, "order_date");
    const monthIndex = withMonth.columns.findIndex(
      (column) => column.name === "order_date_month",
    );
    expect(monthIndex).toBe(2);
    expect(withMonth.rows[0]?.[monthIndex]).toMatch(/^\d{4}-\d{2}$/);
    expect(withMonth.rows).toHaveLength(orders.rows.length);
  });

  it("previews a window of rows and reports the full count", () => {
    const orders = sampleTable("orders");
    if (orders === null) throw new Error("orders sample is missing");
    const preview = previewSampleTable(orders, { offset: 10, limit: 5 });
    expect(preview.rows).toHaveLength(5);
    expect(preview.rowCount).toBe(orders.rows.length);
    expect(preview.rows[0]).toEqual(orders.rows[10]);
  });

  it("formats metric values the way the tiles show them", () => {
    expect(formatMetricValue(1234.5, "number")).toBe("1,234.5");
    expect(formatMetricValue(0.125, "percent")).toBe("12.5%");
    expect(formatMetricValue(12500, "currency")).toBe("$12,500");
    expect(formatMetricValue(12500, "compact_number")).toBe("12.5K");
    expect(formatMetricValue(42, "text")).toBe("42");
  });
});
