import { describe, expect, it } from "vitest";

import {
  analyticsChartBlockRaw,
  type AnalyticsChartData,
} from "../../shared/analytics-chart-block.js";
import { analyticsChartsInBody } from "../../shared/analytics-charts-in-body.js";
import { assertAnalyticsTablesFitAudience } from "./analytics-chart-sharing.js";

function chart(
  type: "line" | "table",
  visibility: "private" | "org" | "public",
  title = "Accounts",
): AnalyticsChartData {
  return {
    dashboard: {
      id: `dash-${title.toLowerCase()}`,
      title,
      url: "https://analytics.example.test/dashboards/accounts",
      visibility,
    },
    panel: {
      id: "p1",
      title: "Top accounts",
      type,
      fingerprint: "0123456789ab",
      url: "https://analytics.example.test/dashboards/accounts?tile=p1",
    },
    filters: {},
    columns: type === "table" ? ["Account", "Seats"] : ["week", "Seats"],
    rows: type === "table" ? [["Acme", 12]] : [["2026-10-05", 12]],
    ...(type === "line" ? { series: [{ label: "Seats" }] } : {}),
    truncated: false,
    capturedAt: "2026-11-07T16:40:00.000Z",
  };
}

function body(...charts: AnalyticsChartData[]): string {
  return [
    "Intro paragraph.",
    ...charts.map((data, index) =>
      analyticsChartBlockRaw(`analytics-chart-0000000${index}`, data),
    ),
    "Closing paragraph.",
  ].join("\n\n");
}

describe("analyticsChartsInBody", () => {
  it("finds every chart in a page body with its numbers", async () => {
    const charts = await analyticsChartsInBody(
      body(chart("line", "org"), chart("table", "private", "Customers")),
    );
    expect(charts.map((found) => found.panel.type)).toEqual(["line", "table"]);
    expect(charts[1]?.rows).toEqual([["Acme", 12]]);
  });

  it("reads a body without charts as none, without parsing it", async () => {
    await expect(analyticsChartsInBody("Just text.")).resolves.toEqual([]);
    await expect(analyticsChartsInBody(null)).resolves.toEqual([]);
  });
});

describe("assertAnalyticsTablesFitAudience", () => {
  it("refuses to share a page wider than a table's dashboard", async () => {
    await expect(
      assertAnalyticsTablesFitAudience(
        body(chart("table", "private", "Customers")),
        "org",
      ),
    ).rejects.toMatchObject({
      errorCode: "analytics_table_wider_than_dashboard",
      statusCode: 409,
      message: expect.stringContaining("the Customers dashboard"),
    });
    await expect(
      assertAnalyticsTablesFitAudience(body(chart("table", "org")), "public"),
    ).rejects.toMatchObject({
      errorCode: "analytics_table_wider_than_dashboard",
    });
  });

  it("lets a page go as wide as its tables' dashboards", async () => {
    await expect(
      assertAnalyticsTablesFitAudience(body(chart("table", "org")), "org"),
    ).resolves.toBeUndefined();
  });

  it("leaves charts and metrics to the share dialog's warning", async () => {
    await expect(
      assertAnalyticsTablesFitAudience(
        body(chart("line", "private")),
        "public",
      ),
    ).resolves.toBeUndefined();
  });

  it("never stops a page from going private", async () => {
    await expect(
      assertAnalyticsTablesFitAudience(
        body(chart("table", "private")),
        "private",
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertAnalyticsTablesFitAudience(undefined, "public"),
    ).resolves.toBeUndefined();
  });
});
