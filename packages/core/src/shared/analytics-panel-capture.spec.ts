import { describe, expect, it } from "vitest";

import {
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
    columns: ["date", "visitors"],
    rows: [
      ["2026-10-27", 1234],
      ["2026-11-03", 1290],
    ],
    series: [{ label: "visitors", color: "#0284C7" }],
    truncated: false,
    capturedAt: "2026-11-03T17:40:00.000Z",
  };

  it("accepts a capture", () => {
    expect(analyticsPanelCaptureSchema.parse(capture)).toEqual(capture);
  });

  it("refuses a series color that isn't a hex color", () => {
    expect(
      analyticsPanelCaptureSchema.safeParse({
        ...capture,
        series: [{ label: "visitors", color: "url(#x)" }],
      }).success,
    ).toBe(false);
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
