import { describe, expect, it } from "vitest";

import type { SqlPanelConfig } from "../app/pages/adhoc/sql-dashboard/types";
import { metricComparison } from "./metric-comparison";

function compare(
  rows: Record<string, unknown>[],
  current: unknown,
  config: SqlPanelConfig | undefined,
) {
  return metricComparison({
    rows,
    current,
    config,
    formatValue: (value) => value.toLocaleString("en-US"),
  });
}

describe("metricComparison", () => {
  it("shows the change from the previous value as a percent", () => {
    expect(
      compare(
        [{ value: 170, previous_value: 588, period: "the 7 days before" }],
        170,
        {
          comparison: {},
        },
      ),
    ).toEqual({
      previous: 588,
      direction: "down",
      tone: "bad",
      change: { kind: "percent", amount: "71" },
      period: "the 7 days before",
    });
    // One decimal under 10%.
    expect(
      compare([{ previous_value: 100 }], 104.26, { comparison: {} })?.change,
    ).toEqual({ kind: "percent", amount: "4.3" });
  });

  it("compares percents in the points they show", () => {
    const fractions = compare([{ previous_value: 0.5 }], 0.53, {
      yFormatter: "percent",
      comparison: {},
    });
    expect(fractions?.change).toEqual({ kind: "points", amount: "3" });
    expect(fractions?.direction).toBe("up");

    const percents = compare([{ previous_value: 40 }], 38.2, {
      yFormatter: "percent",
      comparison: {},
    });
    expect(percents?.change).toEqual({ kind: "points", amount: "1.8" });
    expect(percents?.direction).toBe("down");
  });

  it("shows the change itself when the previous value is 0", () => {
    const comparison = compare([{ previous_value: 0 }], 12, {
      comparison: {},
    });
    expect(comparison?.change).toEqual({ kind: "value", amount: "12" });
    expect(comparison?.direction).toBe("up");
    expect(
      compare([{ previous_value: 0 }], 0, { comparison: {} })?.change,
    ).toEqual({ kind: "none" });
  });

  it("shows a duration change as a duration", () => {
    // 2 days now against 1.5 days before: half a day slower.
    const comparison = compare([{ previous_value: 129_600 }], 172_800, {
      yFormatter: "duration",
      comparison: { better: "lower" },
    });
    expect(comparison?.change).toEqual({ kind: "value", amount: "12 hours" });
    expect(comparison?.direction).toBe("up");
    expect(comparison?.tone).toBe("bad");
  });

  it("colors the change by the panel's better direction", () => {
    const tone = (better: "higher" | "lower" | "neither" | undefined) =>
      compare([{ previous_value: 10 }], 15, { comparison: { better } })?.tone;
    expect(tone(undefined)).toBe("good");
    expect(tone("higher")).toBe("good");
    expect(tone("lower")).toBe("bad");
    expect(tone("neither")).toBe("neutral");

    expect(
      compare([{ previous_value: 15 }], 10, {
        comparison: { better: "lower" },
      })?.tone,
    ).toBe("good");
  });

  it("calls a change that rounds away no change", () => {
    expect(
      compare([{ previous_value: 1000 }], 1000.4, { comparison: {} }),
    ).toMatchObject({
      direction: "flat",
      tone: "neutral",
      change: { kind: "none" },
    });
  });

  it("reads the columns and period label the config names", () => {
    const config: SqlPanelConfig = {
      comparison: {
        previousKey: "last_week",
        periodKey: "window",
        label: "last week",
      },
    };
    expect(
      compare([{ last_week: "50", window: "the week before" }], 60, config),
    ).toMatchObject({ previous: 50, period: "the week before" });
    expect(compare([{ last_week: 50 }], 60, config)?.period).toBe("last week");
    expect(compare([{ last_week: 50 }], 60, { comparison: {} })).toBeNull();
    expect(
      compare([{ previous_value: 50 }], 60, { comparison: {} })?.period,
    ).toBeNull();
  });

  it("compares a summed tile with the sum of its rows' previous values", () => {
    expect(
      compare(
        [
          { value: 30, previous_value: 20 },
          { value: 30, previous_value: 20 },
        ],
        60,
        { comparison: {} },
      ),
    ).toMatchObject({
      previous: 40,
      change: { kind: "percent", amount: "50" },
    });
    expect(
      compare(
        [
          { value: 30, previous_value: 20 },
          { value: 30, previous_value: null },
        ],
        60,
        { comparison: {} },
      ),
    ).toBeNull();
  });

  it("shows nothing without a comparison config, a previous value or a numeric value", () => {
    expect(compare([{ previous_value: 10 }], 15, {})).toBeNull();
    expect(compare([{ previous_value: 10 }], 15, undefined)).toBeNull();
    expect(compare([{ value: 15 }], 15, { comparison: {} })).toBeNull();
    expect(
      compare([{ previous_value: "n/a" }], 15, { comparison: {} }),
    ).toBeNull();
    expect(
      compare([{ previous_value: 10 }], "Healthy", { comparison: {} }),
    ).toBeNull();
    expect(compare([], 15, { comparison: {} })).toBeNull();
  });

  it("shows nothing for a value the panel shows through a value label", () => {
    expect(
      compare([{ previous_value: 1 }], 0, {
        comparison: {},
        valueLabels: { "0": "All green" },
      }),
    ).toBeNull();
  });
});
