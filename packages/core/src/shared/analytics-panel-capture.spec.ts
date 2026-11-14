import { describe, expect, it } from "vitest";

import {
  analyticsCaptureRecords,
  analyticsPanelCaptureSchema,
  parseAnalyticsPanelLink,
} from "./analytics-panel-capture.js";

const ORIGINS = ["https://analytics.agent-native.com"];

describe("parseAnalyticsPanelLink", () => {
  it("reads a panel's copied link with its filters", () => {
    expect(
      parseAnalyticsPanelLink(
        "https://analytics.agent-native.com/dashboards/pod-1-key-levers?f_timeRange=90d&f_app=mail&tab=growth&tile=wau-over-time",
        ORIGINS,
      ),
    ).toEqual({
      dashboardId: "pod-1-key-levers",
      panelId: "wau-over-time",
      filters: { timeRange: "90d", app: "mail" },
    });
  });

  it("accepts a link under an app base path", () => {
    expect(
      parseAnalyticsPanelLink(
        "https://analytics.agent-native.com/analytics/dashboards/abc?tile=p1",
        ORIGINS,
      ),
    ).toEqual({ dashboardId: "abc", panelId: "p1" });
  });

  it("ignores a dashboard link without a panel", () => {
    expect(
      parseAnalyticsPanelLink(
        "https://analytics.agent-native.com/dashboards/abc?f_timeRange=30d",
        ORIGINS,
      ),
    ).toBeNull();
  });

  it("ignores links from other origins and lookalike hosts", () => {
    for (const link of [
      "https://evil.example/dashboards/abc?tile=p1",
      "https://analytics.agent-native.com.evil.example/dashboards/abc?tile=p1",
      "https://user:pass@analytics.agent-native.com/dashboards/abc?tile=p1",
      "javascript:alert(1)",
      "see https://analytics.agent-native.com/dashboards/abc?tile=p1",
    ]) {
      expect(parseAnalyticsPanelLink(link, ORIGINS)).toBeNull();
    }
  });

  it("refuses ids that aren't dashboard or panel ids", () => {
    expect(
      parseAnalyticsPanelLink(
        "https://analytics.agent-native.com/dashboards/a%22b?tile=p1",
        ORIGINS,
      ),
    ).toBeNull();
    expect(
      parseAnalyticsPanelLink(
        "https://analytics.agent-native.com/dashboards/abc?tile=%3Cp%3E",
        ORIGINS,
      ),
    ).toBeNull();
  });
});

describe("analyticsPanelCaptureSchema", () => {
  const capture = {
    dashboard: {
      id: "pod-1-key-levers",
      title: "Pod 1 Key Levers",
      url: "https://analytics.agent-native.com/dashboards/pod-1-key-levers",
      visibility: "org",
    },
    panel: {
      id: "wau-over-time",
      title: "Weekly Active Users",
      type: "area",
      fingerprint: "9f2c41ab03de",
      url: "https://analytics.agent-native.com/dashboards/pod-1-key-levers?tile=wau-over-time",
    },
    filters: { timeRange: "90d" },
    chart: {
      xKey: "date",
      yKeys: ["visitors"],
      colors: ["#0284C7"],
      events: [{ date: "2026-10-30", label: "Launch" }],
    },
    columns: ["date", "visitors"],
    rows: [
      ["2026-10-27", 1234],
      ["2026-11-03", 1290],
    ],
    truncated: false,
    capturedAt: "2026-11-03T17:40:00.000Z",
  };

  it("accepts a capture", () => {
    expect(analyticsPanelCaptureSchema.parse(capture)).toEqual(capture);
  });

  it("takes series colors as plain colors or theme colors, and nothing else", () => {
    const withColors = (colors: string[]) =>
      analyticsPanelCaptureSchema.safeParse({
        ...capture,
        chart: { ...capture.chart, colors },
      }).success;
    expect(
      withColors([
        "#0284c7",
        "var(--brand-blue)",
        "rgb(2, 132, 199)",
        "hsl(200 98% 39% / 0.5)",
        "teal",
      ]),
    ).toBe(true);
    expect(withColors(["url(#x)"])).toBe(false);
    expect(withColors(["var(--a);background:url(x)"])).toBe(false);
    expect(withColors(["rgb(var(--x))"])).toBe(false);
    expect(withColors(["red;fill:url(#x)"])).toBe(false);
  });

  it("names the panel's data source only from the known ones", () => {
    const withSource = (source: string) =>
      analyticsPanelCaptureSchema.safeParse({
        ...capture,
        panel: { ...capture.panel, source },
      }).success;
    expect(withSource("prometheus")).toBe(true);
    expect(withSource("somewhere-else")).toBe(false);
  });

  it("keeps a time range of whole days", () => {
    const withRange = (timeRange: number) =>
      analyticsPanelCaptureSchema.safeParse({ ...capture, timeRange }).success;
    expect(withRange(30)).toBe(true);
    expect(withRange(0)).toBe(false);
    expect(withRange(1.5)).toBe(false);
    expect(withRange(10_000)).toBe(false);
  });

  it("refuses a key date that isn't a calendar date", () => {
    expect(
      analyticsPanelCaptureSchema.safeParse({
        ...capture,
        chart: { ...capture.chart, events: [{ date: "soon", label: "x" }] },
      }).success,
    ).toBe(false);
  });

  it("reads a capture's rows as records keyed by column", () => {
    expect(
      analyticsCaptureRecords({
        columns: ["date", "visitors"],
        rows: [["2026-10-27", 1234], ["2026-11-03"]],
      }),
    ).toEqual([
      { date: "2026-10-27", visitors: 1234 },
      { date: "2026-11-03", visitors: null },
    ]);
  });

  it("refuses unsupported panel types and non-http links", () => {
    expect(
      analyticsPanelCaptureSchema.safeParse({
        ...capture,
        panel: { ...capture.panel, type: "heatmap" },
      }).success,
    ).toBe(false);
    expect(
      analyticsPanelCaptureSchema.safeParse({
        ...capture,
        dashboard: { ...capture.dashboard, url: "javascript:alert(1)" },
      }).success,
    ).toBe(false);
  });
});
