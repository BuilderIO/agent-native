import { describe, expect, it, vi } from "vitest";

import {
  columnFilterType,
  matchesDisplayFilter,
  type DisplayFilter,
  type FilterOperator,
} from "./display-filters";

function filter(
  operator: FilterOperator,
  value = "",
  values: string[] = [],
): DisplayFilter {
  return { id: 1, column: 0, operator, value, end: "", values };
}

describe("report A-RESULT-DECIMAL-FILTER", () => {
  it("distinguishes exact decimal values for equality and membership", () => {
    const value = "9007199254740992.5";
    expect(
      matchesDisplayFilter(
        value,
        filter("equal", "9007199254740992.6"),
        "number",
      ),
    ).toBe(false);
    expect(
      matchesDisplayFilter(
        value,
        filter("not_equal", "9007199254740992.6"),
        "number",
      ),
    ).toBe(true);
    expect(
      matchesDisplayFilter(
        value,
        filter("equal", "9.0071992547409925e15"),
        "number",
      ),
    ).toBe(true);
    expect(
      matchesDisplayFilter(
        value,
        filter("one_of", "", ["9007199254740992.6"]),
        "number",
      ),
    ).toBe(false);
    expect(
      matchesDisplayFilter(
        value,
        filter("not_one_of", "", ["9007199254740992.6"]),
        "number",
      ),
    ).toBe(true);
    expect(
      matchesDisplayFilter(
        value,
        filter("one_of", "", ["9.0071992547409925e15"]),
        "number",
      ),
    ).toBe(true);
  });

  it("orders large decimals and scientific notation exactly", () => {
    const value = "9007199254740992.5";
    expect(
      matchesDisplayFilter(
        "9007199254740993",
        filter("greater", "9007199254740992.5"),
        "number",
      ),
    ).toBe(true);
    expect(
      matchesDisplayFilter(
        "-9007199254740992.6",
        filter("less", "-9007199254740992.5"),
        "number",
      ),
    ).toBe(true);
    expect(matchesDisplayFilter(1.5, filter("greater", "1.4"), "number")).toBe(
      true,
    );
    expect(
      matchesDisplayFilter(
        value,
        filter("less", "9.0071992547409926e15"),
        "number",
      ),
    ).toBe(true);
    expect(
      matchesDisplayFilter(
        value,
        filter("greater", "9007199254740992.4"),
        "number",
      ),
    ).toBe(true);
    expect(
      matchesDisplayFilter(
        value,
        filter("greater_equal", "9007199254740992.6"),
        "number",
      ),
    ).toBe(false);
    expect(
      matchesDisplayFilter(
        value,
        filter("less_equal", "9007199254740992.4"),
        "number",
      ),
    ).toBe(false);
  });

  it("keeps invalid comparisons and null values out of numeric matches", () => {
    expect(
      matchesDisplayFilter("invalid", filter("equal", "1.5"), "number"),
    ).toBe(false);
    expect(
      matchesDisplayFilter("1.5", filter("greater", "invalid"), "number"),
    ).toBe(false);
    expect(
      matchesDisplayFilter("1.5", filter("one_of", "", ["invalid"]), "number"),
    ).toBe(false);
    expect(
      matchesDisplayFilter(
        "1.5",
        filter("not_one_of", "", ["invalid"]),
        "number",
      ),
    ).toBe(true);
    expect(
      matchesDisplayFilter(null, filter("not_one_of", "", ["1.5"]), "number"),
    ).toBe(false);
    expect(matchesDisplayFilter(null, filter("is_null"), "number")).toBe(true);
  });

  it("caches inferred column types across 10,000 sparse rows", () => {
    const rows: unknown[][] = Array.from({ length: 10_000 }, (_, i) => [
      i,
      i === 9_999 ? "oldest-row-needle" : null,
    ]);
    const findSpy = vi.spyOn(rows, "find");
    const col = { name: "sparse_notes" };
    const active: DisplayFilter = {
      id: 1,
      column: 1,
      operator: "not_null",
      value: "",
      end: "",
      values: [],
    };
    const matched = rows.filter((row) =>
      matchesDisplayFilter(row[1], active, columnFilterType(col, rows, 1)),
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]?.[1]).toBe("oldest-row-needle");
    expect(findSpy).toHaveBeenCalledTimes(1);
  });
});
