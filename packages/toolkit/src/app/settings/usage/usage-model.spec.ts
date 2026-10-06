import { describe, expect, it } from "vitest";

import {
  buildDailySeries,
  displayUnit,
  lookbackDates,
  seriesId,
  usageAmount,
  USAGE_OTHER_KEY,
} from "./usage-model.js";

describe("usageAmount", () => {
  it("reads dollars when the engine bills in USD", () => {
    expect(displayUnit({ unit: "usd" })).toBe("usd");
    expect(usageAmount({ costCents: 250 }, { unit: "usd" })).toBe(2.5);
  });

  it("reads Builder.io credits, estimated from cost when none are reported", () => {
    const billing = {
      unit: "builder-credits" as const,
      hardCostMarginMultiplier: 1.25,
      creditsPerUsd: 20,
    };
    expect(displayUnit(billing)).toBe("credits");
    expect(usageAmount({ costCents: 100 }, billing)).toBe(25);
    expect(
      usageAmount(
        { costCents: 100, builderCredits: 3, estimatedBuilderCredits: 1.5 },
        billing,
      ),
    ).toBe(4.5);
  });

  it("counts only credits under mixed billing", () => {
    expect(
      usageAmount(
        { costCents: 900, builderCredits: 2, otherCostCents: 900 },
        { unit: "mixed" },
      ),
    ).toBe(2);
    expect(usageAmount({ costCents: 900 }, { unit: "mixed" })).toBe(0);
  });
});

describe("buildDailySeries", () => {
  const dates = lookbackDates(3, Date.UTC(2026, 8, 25, 15));

  it("covers every day in the lookback, ending today", () => {
    expect(dates).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
  });

  it("fills empty days with zero and orders series by total, other last", () => {
    const series = buildDailySeries(
      [
        { date: "2026-09-23", key: USAGE_OTHER_KEY, value: 50 },
        { date: "2026-09-23", key: "chat", value: 2 },
        { date: "2026-09-25", key: "automations", value: 5 },
        { date: "2026-09-25", key: "chat", value: 4 },
        { date: "2026-08-01", key: "chat", value: 99 },
      ],
      dates,
      (entry) => entry.value,
    );

    expect(series.keys).toEqual(["chat", "automations", USAGE_OTHER_KEY]);
    expect(series.total).toBe(61);
    expect(series.rows).toEqual([
      {
        date: "2026-09-23",
        [seriesId(0)]: 2,
        [seriesId(1)]: 0,
        [seriesId(2)]: 50,
      },
      {
        date: "2026-09-24",
        [seriesId(0)]: 0,
        [seriesId(1)]: 0,
        [seriesId(2)]: 0,
      },
      {
        date: "2026-09-25",
        [seriesId(0)]: 4,
        [seriesId(1)]: 5,
        [seriesId(2)]: 0,
      },
    ]);
  });

  it("drops series with nothing in range", () => {
    const series = buildDailySeries(
      [{ date: "2026-09-24", key: "chat", value: 0 }],
      dates,
      (entry) => entry.value,
    );
    expect(series.keys).toEqual([]);
    expect(series.total).toBe(0);
  });
});
