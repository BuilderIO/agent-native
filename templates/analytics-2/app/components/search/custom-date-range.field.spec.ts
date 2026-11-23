import { describe, expect, it } from "vitest";

import {
  CUSTOM_DATE_FIELDS,
  CUSTOM_DATE_MODES,
  customDateFieldLabel,
  customDateLabel,
  DEFAULT_DATE_FIELD,
  rangeIsComplete,
} from "./custom-date-range";
import {
  addMonths,
  dayState,
  monthGrid,
  nextRangeForClick,
  todayDay,
} from "./date-grid";

/**
 * The Date filter's field selector and calendar are the reference's own controls:
 * a "Last edited" / "Created" field, an After / Before / Between mode, and a month
 * grid the day is picked in. These lock the values and the pick order.
 */
describe("date filter field selector", () => {
  it("offers Last edited then Created, and starts on Last edited", () => {
    expect(CUSTOM_DATE_FIELDS.map((entry) => entry.label)).toEqual([
      "Last edited",
      "Created",
    ]);
    expect(DEFAULT_DATE_FIELD).toBe("lastEdited");
    expect(customDateFieldLabel("created")).toBe("Created");
    expect(customDateFieldLabel(DEFAULT_DATE_FIELD)).toBe("Last edited");
  });

  it("names a one-day pick with the field, the mode and the day", () => {
    expect(
      customDateLabel(
        { from: "2026-11-02", to: "" },
        "after",
        "Last edited",
        "en-US",
      ),
    ).toBe("Last edited after 11/2/2026");
    expect(
      customDateLabel(
        { from: "2026-11-02", to: "" },
        "before",
        "Created",
        "en-US",
      ),
    ).toBe("Created before 11/2/2026");
  });

  it("names a two-ended pick as the field and the two days", () => {
    expect(
      customDateLabel(
        { from: "2026-11-01", to: "2026-11-13" },
        "between",
        "Last edited",
        "en-US",
      ),
    ).toBe("Last edited 11/1/2026 - 11/13/2026");
  });

  it("falls back to the plain Date label until a day is picked", () => {
    expect(customDateLabel(null, "after", "Last edited", "en-US")).toBe("Date");
    expect(
      customDateLabel(
        { from: "2026-11-01", to: "" },
        "between",
        "Created",
        "en-US",
      ),
    ).toBe("Date");
    expect(CUSTOM_DATE_MODES.map((entry) => entry.label)).toEqual([
      "After",
      "Before",
      "Between",
    ]);
  });
});

describe("date filter completeness", () => {
  it("needs one day for After and Before, and both for Between", () => {
    expect(rangeIsComplete({ from: "2026-11-02", to: "" }, "after")).toBe(true);
    expect(rangeIsComplete({ from: "2026-11-02", to: "" }, "before")).toBe(
      true,
    );
    expect(rangeIsComplete({ from: "2026-11-02", to: "" }, "between")).toBe(
      false,
    );
    expect(
      rangeIsComplete({ from: "2026-11-02", to: "2026-11-05" }, "between"),
    ).toBe(true);
    expect(rangeIsComplete(null, "after")).toBe(false);
  });
});

describe("calendar grid", () => {
  it("draws six weeks starting on the Sunday of the first's week", () => {
    // 2026-11-01 is a Sunday, so November 2026 fills from its own first day.
    const november = monthGrid("2026-11-01");
    expect(november).toHaveLength(42);
    expect(november[0]).toEqual({ day: "2026-11-01", inMonth: true });
    expect(november[29]).toEqual({ day: "2026-11-30", inMonth: true });
    expect(november[30]).toEqual({ day: "2026-12-01", inMonth: false });
    expect(november[41]).toEqual({ day: "2026-12-12", inMonth: false });
  });

  it("backs up to the Sunday the week begins on for a mid-week month start", () => {
    // 2026-10-01 is a Thursday, so the grid opens on Sunday 2026-09-27.
    const october = monthGrid("2026-10-01");
    expect(october.slice(0, 5).map((cell) => cell.day)).toEqual([
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
    ]);
    expect(october.slice(0, 4).map((cell) => cell.inMonth)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("steps whole months across a year boundary", () => {
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });

  it("marks the picked day, and both ends of a range", () => {
    expect(dayState("2026-11-02", { from: "2026-11-02", to: "" })).toBe(
      "selected",
    );
    const range = { from: "2026-11-02", to: "2026-11-05" };
    expect(dayState("2026-11-02", range)).toBe("range-start");
    expect(dayState("2026-11-03", range)).toBe("in-range");
    expect(dayState("2026-11-05", range)).toBe("range-end");
    expect(dayState("2026-11-06", range)).toBe("none");
  });

  it("takes one click for After and Before, two for Between", () => {
    expect(nextRangeForClick("2026-11-02", "after", null)).toEqual({
      from: "2026-11-02",
      to: "2026-11-02",
    });
    const started = nextRangeForClick("2026-11-02", "between", null);
    expect(started).toEqual({ from: "2026-11-02", to: "" });
    expect(nextRangeForClick("2026-11-05", "between", started)).toEqual({
      from: "2026-11-02",
      to: "2026-11-05",
    });
    // A second click before the first closes the range the other way round.
    expect(nextRangeForClick("2026-10-30", "between", started)).toEqual({
      from: "2026-10-30",
      to: "2026-11-02",
    });
    // A third click starts over.
    expect(
      nextRangeForClick("2026-11-09", "between", {
        from: "2026-11-02",
        to: "2026-11-05",
      }),
    ).toEqual({ from: "2026-11-09", to: "" });
  });

  it("knows today as an ISO day", () => {
    expect(todayDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
