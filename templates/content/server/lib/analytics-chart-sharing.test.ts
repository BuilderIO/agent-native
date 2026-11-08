import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  members: new Set<string>(),
}));

vi.mock("@agent-native/core/org", () => ({
  isOrgMember: async (orgId: string, email: string) =>
    mocks.members.has(`${orgId}:${email}`),
}));

import { runWithRequestContext } from "@agent-native/core/server/request-context";

import {
  analyticsChartBlockRaw,
  type AnalyticsChartData,
} from "../../shared/analytics-chart-block.js";
import { analyticsChartsInBody } from "../../shared/analytics-charts-in-body.js";
import {
  assertAnalyticsTablesFitAudience,
  assertAnalyticsTablesFitSharingChange,
  sharesAudience,
} from "./analytics-chart-sharing.js";

beforeEach(() => {
  mocks.members = new Set(["org_1:colleague@example.test"]);
});

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

/** A chart tag whose numbers are there but whose dashboard isn't. */
function withoutDashboard(data: AnalyticsChartData): string {
  return body(data).replace(/ dashboard=\{\{[^}]*\}\}/, "");
}

describe("analyticsChartsInBody", () => {
  it("finds every chart in a page body with its numbers", async () => {
    const { charts, unreadable } = await analyticsChartsInBody(
      body(chart("line", "org"), chart("table", "private", "Customers")),
    );
    expect(charts.map((found) => found.panel.type)).toEqual(["line", "table"]);
    expect(charts[1]?.rows).toEqual([["Acme", 12]]);
    expect(unreadable).toBe(0);
  });

  it("reads a body without charts as none, without parsing it", async () => {
    const none = { charts: [], unreadable: 0 };
    await expect(analyticsChartsInBody("Just text.")).resolves.toEqual(none);
    await expect(analyticsChartsInBody(null)).resolves.toEqual(none);
  });

  it("counts a chart tag that doesn't read as one", async () => {
    const content = withoutDashboard(chart("table", "org"));
    expect(content).toContain("Acme");
    expect(content).not.toContain("dashboard=");
    await expect(analyticsChartsInBody(content)).resolves.toEqual({
      charts: [],
      unreadable: 1,
    });
  });
});

describe("sharesAudience", () => {
  it("counts colleagues and the organization's groups as the organization", async () => {
    await expect(sharesAudience("org_1", [])).resolves.toBe("private");
    await expect(
      sharesAudience("org_1", [
        { principalType: "user", principalId: "colleague@example.test" },
        { principalType: "group", principalId: "grp_1" },
        { principalType: "org", principalId: "org_1" },
      ]),
    ).resolves.toBe("org");
  });

  it("counts anyone outside the organization as everyone", async () => {
    for (const share of [
      { principalType: "user", principalId: "guest@elsewhere.test" },
      { principalType: "org", principalId: "org_2" },
      { principalType: "link", principalId: "anyone" },
    ]) {
      await expect(
        sharesAudience("org_1", [
          { principalType: "user", principalId: "colleague@example.test" },
          share,
        ]),
      ).resolves.toBe("public");
    }
    await expect(
      sharesAudience(null, [
        { principalType: "user", principalId: "colleague@example.test" },
      ]),
    ).resolves.toBe("public");
  });

  it("checks a personal page's shares against the caller's organization", async () => {
    const colleague = [
      { principalType: "user", principalId: "colleague@example.test" },
    ];
    await expect(
      runWithRequestContext(
        { userEmail: "owner@example.test", orgId: "org_1" },
        () => sharesAudience(null, colleague),
      ),
    ).resolves.toBe("org");
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

  it("counts sharing a private page with someone as opening it to the organization", async () => {
    const content = body(chart("table", "private"));
    await expect(
      assertAnalyticsTablesFitSharingChange({
        resource: { content, visibility: "private" },
        change: { kind: "grant" },
      }),
    ).rejects.toMatchObject({
      errorCode: "analytics_table_wider_than_dashboard",
    });
    await expect(
      assertAnalyticsTablesFitSharingChange({
        resource: {
          content: body(chart("table", "org")),
          visibility: "private",
        },
        change: { kind: "grant" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertAnalyticsTablesFitSharingChange({
        resource: {
          content: body(chart("table", "org")),
          visibility: "public",
        },
        change: { kind: "grant" },
      }),
    ).rejects.toMatchObject({
      errorCode: "analytics_table_wider_than_dashboard",
    });
  });

  it("refuses to widen a page holding a chart tag that doesn't read", async () => {
    const content = withoutDashboard(chart("line", "public"));
    await expect(
      assertAnalyticsTablesFitAudience(content, "org"),
    ).rejects.toMatchObject({
      errorCode: "analytics_chart_unreadable",
      statusCode: 409,
    });
    await expect(
      assertAnalyticsTablesFitAudience(content, "private"),
    ).resolves.toBeUndefined();
  });

  it("works out the audience only for a page holding charts", async () => {
    const audience = vi.fn(async () => "public" as const);
    await expect(
      assertAnalyticsTablesFitAudience("Just text.", audience),
    ).resolves.toBeUndefined();
    expect(audience).not.toHaveBeenCalled();
    await expect(
      assertAnalyticsTablesFitAudience(body(chart("table", "org")), audience),
    ).rejects.toMatchObject({
      errorCode: "analytics_table_wider_than_dashboard",
    });
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
