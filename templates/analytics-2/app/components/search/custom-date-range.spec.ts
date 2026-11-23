import { describe, expect, it } from "vitest";

import {
  customRangeBounds,
  customRangeParams,
  isIsoDay,
  withinRange,
} from "./custom-date-range";

/**
 * Row 592: the Date filter offered only relative presets. The reference's filter
 * row is an editable date field with a picker, so a reader can name a day or a
 * range. These rules hold without a browser.
 */
describe("search custom date range", () => {
  it("turns a typed range into inclusive bounds", () => {
    const bounds = customRangeBounds({ from: "2026-11-01", to: "2026-11-03" });
    expect(bounds).not.toBeNull();
    if (!bounds || "error" in bounds) throw new Error("expected bounds");
    expect(new Date(bounds.sinceMs).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    // the last day counts in full
    expect(new Date(bounds.untilMs).toISOString()).toBe(
      "2026-11-03T23:59:59.999Z",
    );
    expect(bounds.label).toBe("Nov 1, 2026 – Nov 3, 2026");
  });

  it("allows a single day and forgives the order", () => {
    const same = customRangeBounds({ from: "2026-11-02", to: "2026-11-02" });
    expect(same && !("error" in same) && same.label).toBe("Nov 2, 2026");
    const reversed = customRangeBounds({
      from: "2026-11-05",
      to: "2026-11-01",
    });
    if (!reversed || "error" in reversed) throw new Error("expected bounds");
    expect(new Date(reversed.sinceMs).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(new Date(reversed.untilMs).toISOString()).toBe(
      "2026-11-05T23:59:59.999Z",
    );
  });

  it("refuses a half-filled or impossible date instead of guessing", () => {
    expect(customRangeBounds({ from: "2026-11-01", to: "" })).toEqual({
      error: "Choose a start and end date.",
    });
    expect(customRangeBounds({ from: "2026-02-31", to: "2026-03-01" })).toEqual(
      {
        error: "Choose a start and end date.",
      },
    );
    expect(isIsoDay("2026-2-3")).toBe(false);
    expect(isIsoDay("2026-02-03")).toBe(true);
  });

  it("keeps an empty range meaning no date filter at all", () => {
    expect(customRangeBounds({ from: "", to: "" })).toBeNull();
    expect(customRangeParams({ from: "", to: "" })).toEqual({
      dateFrom: null,
      dateTo: null,
    });
  });

  it("matches only timestamps inside the bounds", () => {
    const bounds = customRangeBounds({ from: "2026-11-01", to: "2026-11-01" });
    if (!bounds || "error" in bounds) throw new Error("expected bounds");
    expect(withinRange("2026-11-01T12:00:00.000Z", bounds)).toBe(true);
    expect(withinRange("2026-11-02T00:00:00.000Z", bounds)).toBe(false);
    expect(withinRange("2026-10-31T23:59:59.999Z", bounds)).toBe(false);
  });
});
