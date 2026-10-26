import { describe, expect, it } from "vitest";

import {
  isNumericColumnFormat,
  numberTableColumns,
  tableQuantity,
} from "./table-columns";

describe("numberTableColumns", () => {
  it("right-aligns number formats and text that reads as a number", () => {
    const columns = numberTableColumns(
      [
        { key: "name" },
        { key: "count" },
        { key: "share", format: "percent" },
        { key: "wait" },
        { key: "avgTime" },
        { key: "price" },
        { key: "code", format: "text" },
        { key: "day" },
        { key: "signedUp", format: "date" },
        { key: "url", format: "link" },
        { key: "empty" },
      ],
      [
        {
          name: "Mail",
          count: "1,200",
          share: 0.4,
          wait: "4.8 days",
          avgTime: "1m 42s",
          price: "$12.50",
          code: "123",
          day: "2026-10-01",
          signedUp: "2026-10-01T09:30:00Z",
          url: "42",
          empty: null,
        },
        {
          name: "Slides",
          count: 7,
          share: 0.6,
          wait: "3 min",
          avgTime: "0m 58s",
          price: "€8",
          code: "456",
          day: "2026-10-02",
          signedUp: "2026-10-02T09:30:00Z",
          url: "43",
          empty: "",
        },
      ],
    );
    expect([...columns]).toEqual([
      "count",
      "share",
      "wait",
      "avgTime",
      "price",
    ]);
  });

  it("keeps a column left when one value is not a number, however far down", () => {
    const rows = Array.from({ length: 300 }, () => ({ wait: "4.8 days" }));
    rows.push({ wait: "pending" });
    expect([...numberTableColumns([{ key: "wait" }], rows)]).toEqual([]);
  });

  it("reads a dash as a missing value", () => {
    expect([
      ...numberTableColumns(
        [{ key: "median" }],
        [{ median: "4 min" }, { median: "–" }, { median: " " }],
      ),
    ]).toEqual(["median"]);
  });

  it("names the number formats", () => {
    expect(
      ["number", "currency", "percent", "delta", "duration"].every((format) =>
        isNumericColumnFormat(format as never),
      ),
    ).toBe(true);
    expect(isNumericColumnFormat("text")).toBe(false);
    expect(isNumericColumnFormat(undefined)).toBe(false);
  });
});

describe("tableQuantity", () => {
  it("reads numbers, money, percents and counts with a unit", () => {
    expect(tableQuantity(12)).toBe(12);
    expect(tableQuantity(Number.NaN)).toBeNull();
    expect(tableQuantity("1,200")).toBe(1200);
    expect(tableQuantity("-3.1")).toBe(-3.1);
    expect(tableQuantity("$12.50")).toBe(12.5);
    expect(tableQuantity("12%")).toBe(12);
    expect(tableQuantity("3 PRs")).toBe(3);
  });

  it("reads thousands, millions and billions", () => {
    expect(tableQuantity("1.2K")).toBe(1200);
    expect(tableQuantity("3.4M")).toBe(3_400_000);
    expect(tableQuantity("$5m")).toBe(5_000_000);
    expect(tableQuantity("2bn")).toBe(2e9);
  });

  it("reads durations as seconds", () => {
    expect(tableQuantity("45 sec")).toBe(45);
    expect(tableQuantity("4 min")).toBe(240);
    expect(tableQuantity("5m")).toBe(300);
    expect(tableQuantity("7.4 hours")).toBeCloseTo(26_640);
    expect(tableQuantity("4.8 days")).toBeCloseTo(414_720);
    expect(tableQuantity("1m 42s")).toBe(102);
    expect(tableQuantity("2 hours 5 min")).toBe(7500);
  });

  it("returns null for text that isn't a quantity", () => {
    for (const value of [
      "",
      "pending",
      "2026-10-01",
      "09:30",
      "v1.2",
      "3 PRs 2 reviews",
      null,
      true,
    ]) {
      expect(tableQuantity(value), String(value)).toBeNull();
    }
  });
});
