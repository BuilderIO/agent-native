// The reference's date filter has three modes with its own copy and order: "After", "Before", "Between",
// with "After" chosen first.
// After/Before name one day; Between names a first and a last day. This pins the mapping onto the bounds the
// search uses and onto the action's own dateFrom/dateTo transport.
import { describe, expect, it } from "vitest";

import {
  CUSTOM_DATE_MODES,
  customRangeBounds,
  customRangeParams,
  withinRange,
} from "./custom-date-range";

describe("custom date modes", () => {
  it("offers the reference's modes in the reference's order", () => {
    expect(CUSTOM_DATE_MODES.map((entry) => entry.label)).toEqual([
      "After",
      "Before",
      "Between",
    ]);
    expect(CUSTOM_DATE_MODES.map((entry) => entry.mode)).toEqual([
      "after",
      "before",
      "between",
    ]);
  });

  it("After takes the typed day as a lower bound and no upper bound", () => {
    const bounds = customRangeBounds(
      { from: "2026-03-04", to: "" },
      "en-US",
      "after",
    );
    expect(bounds && !("error" in bounds)).toBe(true);
    if (!bounds || "error" in bounds) return;
    expect(bounds.sinceMs).toBe(Date.parse("2026-03-04T00:00:00Z"));
    expect(withinRange("2026-03-04T00:00:00Z", bounds)).toBe(true);
    expect(withinRange("2026-03-03T23:59:59Z", bounds)).toBe(false);
    expect(withinRange("2031-01-01T00:00:00Z", bounds)).toBe(true);
  });

  it("Before takes the typed day as an upper bound, end day included", () => {
    const bounds = customRangeBounds(
      { from: "2026-03-04", to: "" },
      "en-US",
      "before",
    );
    if (!bounds || "error" in bounds) throw new Error("expected bounds");
    expect(withinRange("2026-03-04T23:59:59Z", bounds)).toBe(true);
    expect(withinRange("2026-03-05T00:00:00Z", bounds)).toBe(false);
    expect(withinRange("2020-01-01T00:00:00Z", bounds)).toBe(true);
  });

  it("Between still needs both days and orders them", () => {
    const forward = customRangeBounds(
      { from: "2026-03-01", to: "2026-03-04" },
      "en-US",
      "between",
    );
    const reversed = customRangeBounds(
      { from: "2026-03-04", to: "2026-03-01" },
      "en-US",
      "between",
    );
    if (!forward || "error" in forward) throw new Error("expected bounds");
    expect(forward.sinceMs).toBe(
      reversed && !("error" in reversed) ? reversed.sinceMs : NaN,
    );
    expect(withinRange("2026-03-02T12:00:00Z", forward)).toBe(true);
    expect(withinRange("2026-03-05T00:00:00Z", forward)).toBe(false);
  });

  it("refuses an empty or malformed day in every mode", () => {
    expect(
      customRangeBounds({ from: "", to: "" }, "en-US", "after"),
    ).toBeNull();
    const bad = customRangeBounds(
      { from: "3/4/2026", to: "" },
      "en-US",
      "after",
    );
    expect(bad && "error" in bad).toBe(true);
  });

  it("sends one side of the range to the action for After and Before", () => {
    expect(customRangeParams({ from: "2026-03-04", to: "" }, "after")).toEqual({
      dateFrom: "2026-03-04",
      dateTo: null,
    });
    expect(customRangeParams({ from: "2026-03-04", to: "" }, "before")).toEqual(
      {
        dateFrom: null,
        dateTo: "2026-03-04",
      },
    );
    // Between keeps the existing transport shape: the bounds as ISO instants (the action parses either form).
    const between = customRangeParams(
      { from: "2026-03-01", to: "2026-03-04" },
      "between",
    );
    expect(between.dateFrom).toBe("2026-03-01T00:00:00.000Z");
    expect(between.dateTo).toBe("2026-03-04T23:59:59.999Z");
  });
});
