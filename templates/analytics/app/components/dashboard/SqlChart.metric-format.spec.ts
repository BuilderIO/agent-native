import { describe, it, expect } from "vitest";

import {
  detectMetricValueColumn,
  formatMetricValue,
  safeDashboardLinkHref,
  sessionReplayHref,
  shouldSplitCurrentDayTimeSeries,
  sortTooltipPayloadItems,
  splitCurrentDayTimeSeriesRows,
  sqlChartLocalDateKey,
  toSqlChartDateKey,
} from "./SqlChart";

// Postgres/Neon returns numeric & bigint columns as STRINGS (SQLite returns JS
// numbers). The metric renderer used to only format `typeof raw === "number"`,
// so a Postgres rate like "0.00000000000000000000" was dumped verbatim instead
// of being shown as "0.00%". formatMetricValue coerces numeric strings first.
describe("formatMetricValue", () => {
  it("formats a Postgres numeric-string rate as a percent (the reported bug)", () => {
    // 21-decimal string exactly like the live "Viral Signup Share" panel showed
    expect(formatMetricValue("0.000000000000000000000", "percent")).toBe(
      "0.00%",
    );
  });

  it("formats a non-zero numeric-string rate as a percent", () => {
    expect(formatMetricValue("0.5", "percent")).toBe("50.00%");
    expect(formatMetricValue("0.1234", "percent")).toBe("12.34%");
  });

  it("formats a numeric-string coefficient (K) with the number formatter", () => {
    expect(formatMetricValue("0.3333333333", "number")).toBe("0.333");
    expect(formatMetricValue("2", "number")).toBe("2");
  });

  it("still formats plain JS numbers (SQLite path) unchanged", () => {
    expect(formatMetricValue(0, "percent")).toBe("0.00%");
    expect(formatMetricValue(42, "number")).toBe("42");
  });

  it("formats bigint count strings as plain integers", () => {
    expect(formatMetricValue("0", "number")).toBe("0");
    expect(formatMetricValue("1234", "number")).toBe("1,234");
  });

  it("honors a valueLabels override before any coercion", () => {
    expect(formatMetricValue("3", "number", { "3": "Tier 3" })).toBe("Tier 3");
  });

  it("leaves genuinely non-numeric strings untouched", () => {
    expect(formatMetricValue("n/a", "number")).toBe("n/a");
    expect(formatMetricValue("", "number")).toBe(""); // preserved original behavior
    expect(formatMetricValue(null, "number")).toBe("-");
    expect(formatMetricValue(undefined, "number")).toBe("-");
  });
});

describe("detectMetricValueColumn", () => {
  it("prefers numeric-string columns over leading label columns", () => {
    expect(
      detectMetricValueColumn({
        metric: "Visual Views",
        billing_type: "rollover",
        amount: "30299",
      }),
    ).toBe("amount");
  });

  it("keeps an explicit configured metric column when present", () => {
    expect(
      detectMetricValueColumn(
        {
          label: "Seats",
          total: "57532",
        },
        "total",
      ),
    ).toBe("total");
  });
});

describe("sortTooltipPayloadItems", () => {
  it("sorts numeric tooltip rows descending while keeping ties stable", () => {
    const items = [
      { name: "analytics", value: 69 },
      { name: "docs", value: "1025" },
      { name: "forms", value: 25 },
      { name: "content", value: 69 },
    ];

    expect(sortTooltipPayloadItems(items).map((item) => item.name)).toEqual([
      "docs",
      "analytics",
      "content",
      "forms",
    ]);
  });

  it("de-dupes split partial-day overlay items by display name", () => {
    const items = [
      { name: "analytics", dataKey: "analytics_solid", value: 25 },
      { name: "analytics", dataKey: "analytics_partial", value: 25 },
      { name: "docs", dataKey: "docs_solid", value: 40 },
    ];

    expect(sortTooltipPayloadItems(items).map((item) => item.dataKey)).toEqual([
      "docs_solid",
      "analytics_solid",
    ]);
  });
});

describe("safeDashboardLinkHref", () => {
  it("keeps http, https, and root-relative links", () => {
    expect(safeDashboardLinkHref("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(safeDashboardLinkHref("http://example.com/path")).toBe(
      "http://example.com/path",
    );
    expect(safeDashboardLinkHref("/dashboards/example")).toBe(
      "/dashboards/example",
    );
  });

  it("blocks unsafe or incomplete link targets", () => {
    expect(safeDashboardLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeDashboardLinkHref("data:text/html,hi")).toBeNull();
    expect(safeDashboardLinkHref("//evil.example/path")).toBeNull();
    expect(safeDashboardLinkHref("example.com/path")).toBeNull();
    expect(safeDashboardLinkHref("")).toBeNull();
  });
});

describe("sessionReplayHref", () => {
  it("links recording ids directly to replay detail pages", () => {
    expect(sessionReplayHref({ recording_id: "sr_123" })).toBe(
      "/sessions/sr_123",
    );
  });

  it("links bare session ids to the filtered sessions list", () => {
    expect(sessionReplayHref({ session_id: "sess_123" })).toBe(
      "/sessions?range=all&q=sess_123",
    );
  });

  it("prefers recording ids when both ids are present", () => {
    expect(
      sessionReplayHref({ recording_id: "sr_123", session_id: "sess_123" }),
    ).toBe("/sessions/sr_123");
  });

  it("encodes session ids in list filters", () => {
    expect(sessionReplayHref({ session_id: "session with/slash" })).toBe(
      "/sessions?range=all&q=session+with%2Fslash",
    );
  });
});

describe("partial-day time-series helpers", () => {
  it("only enables the partial-day overlay for daily chart keys", () => {
    expect(
      shouldSplitCurrentDayTimeSeries({ source: "first-party" }, "date"),
    ).toBe(true);
    expect(
      shouldSplitCurrentDayTimeSeries({ source: "prometheus" }, "timestamp"),
    ).toBe(false);
    expect(
      shouldSplitCurrentDayTimeSeries({ source: "demo" }, "timestamp"),
    ).toBe(false);
  });

  it("formats a date key in the dashboard reporting timezone", () => {
    expect(
      sqlChartLocalDateKey(
        new Date("2026-06-25T06:30:00.000Z"),
        "America/Los_Angeles",
      ),
    ).toBe("2026-06-24");
  });

  it("normalizes date strings without shifting date-only values through UTC", () => {
    expect(toSqlChartDateKey("2026-06-24")).toBe("2026-06-24");
    expect(toSqlChartDateKey("20260624")).toBe("2026-06-24");
    expect(toSqlChartDateKey("2026-06-25T06:30:00.000Z")).toBe("2026-06-24");
  });

  it("splits the current day into a dashed overlay segment", () => {
    const result = splitCurrentDayTimeSeriesRows(
      [
        { date: "2026-06-22", signups: 10 },
        { date: "2026-06-23", signups: 12 },
        { date: "2026-06-24", signups: 3 },
      ],
      "date",
      ["signups"],
      "2026-06-24",
    );
    const series = result.series[0];

    expect(series.solidKey).not.toBe("signups");
    expect(series.partialKey).toBeTruthy();
    expect(result.rows.map((row) => row[series.solidKey])).toEqual([
      10,
      12,
      null,
    ]);
    expect(result.rows.map((row) => row[series.partialKey!])).toEqual([
      null,
      12,
      3,
    ]);
  });

  it("leaves complete historical series untouched", () => {
    const rows = [
      { date: "2026-06-22", signups: 10 },
      { date: "2026-06-23", signups: 12 },
    ];
    const result = splitCurrentDayTimeSeriesRows(
      rows,
      "date",
      ["signups"],
      "2026-06-24",
    );

    expect(result.rows).toBe(rows);
    expect(result.series).toEqual([
      { key: "signups", solidKey: "signups", partialKey: null },
    ]);
  });
});
