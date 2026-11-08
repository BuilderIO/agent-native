import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userEmail: undefined as string | undefined,
  resolveDocumentAccess: vi.fn(),
  requestAnalytics: vi.fn(),
  track: vi.fn(),
  shares: [] as { principalType: string; principalId: string }[],
}));

vi.mock("../server/db/index.js", () => ({
  schema: { documentShares: { resourceId: "resource_id" } },
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => mocks.shares }) }),
  }),
}));

vi.mock("@agent-native/core/org", () => ({
  isOrgMember: async (orgId: string, email: string) =>
    orgId === "org_1" && email.endsWith("@example.test"),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.userEmail,
  getRequestOrgId: () => "org_1",
}));

vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));

vi.mock("./_document-access.js", () => ({
  resolveDocumentAccess: mocks.resolveDocumentAccess,
}));

vi.mock("../server/lib/public-documents.js", () => ({
  isPublicViewerOwner: (email: string) => email.startsWith("public-"),
}));

vi.mock("../server/lib/analytics-peer.js", () => ({
  requestAnalytics: mocks.requestAnalytics,
  resolveAnalyticsAppUrl: () => "https://analytics.example.test",
  analyticsLinkOrigins: () => [
    "https://analytics.example.test",
    "https://analytics.beta.example.test",
  ],
}));

import captureAnalyticsChart from "./capture-analytics-chart";
import getAnalyticsChartStatus from "./get-analytics-chart-status";
import getAnalyticsLinks from "./get-analytics-links";

const LINK =
  "https://analytics.example.test/dashboards/growth?f_timeRange=90d&tile=wau";

function chart(
  overrides: {
    visibility?: "private" | "org" | "public";
    type?: "line" | "table" | "metric";
  } = {},
) {
  const type = overrides.type ?? "line";
  return {
    dashboard: {
      id: "growth",
      title: "Growth",
      url: "https://analytics.example.test/dashboards/growth",
      visibility: overrides.visibility ?? "org",
    },
    panel: {
      id: "wau",
      title: "Weekly active users",
      type,
      fingerprint: "0123456789ab",
      url: "https://analytics.example.test/dashboards/growth?tile=wau",
    },
    filters: { timeRange: "90d" },
    filterSummary: "Time range: Last 90 days",
    columns: type === "table" ? ["Account", "Seats"] : ["week", "Users"],
    rows:
      type === "table"
        ? [["Acme", 12]]
        : [
            ["2026-10-05", 120],
            ["2026-10-12", 140],
          ],
    ...(type === "line" ? { series: [{ label: "Users" }] } : {}),
    truncated: false,
    capturedAt: "2026-11-07T16:40:00.000Z",
  };
}

function page(visibility: "private" | "org" | "public", role = "editor") {
  return {
    role,
    resource: {
      id: "doc_1",
      ownerEmail: "owner@example.test",
      orgId: "org_1",
      visibility,
      trashedAt: null,
    },
    authority: { userEmail: mocks.userEmail, orgId: "org_1" },
  };
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return {
      errorCode: (error as { errorCode?: string }).errorCode,
      statusCode: (error as { statusCode?: number }).statusCode,
    };
  }
  throw new Error("expected the action to fail");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userEmail = "editor@example.test";
  mocks.shares = [];
  mocks.resolveDocumentAccess.mockResolvedValue(page("private"));
  mocks.requestAnalytics.mockResolvedValue({ ok: true, data: chart() });
});

describe("capture-analytics-chart", () => {
  it("has Analytics run a pasted panel link as the editor and returns the tag", async () => {
    const result = await captureAnalyticsChart.run({
      documentId: "doc_1",
      link: LINK,
      purpose: "insert",
    });
    expect(mocks.resolveDocumentAccess).toHaveBeenCalledWith("doc_1", {
      skipResourceBody: true,
    });
    expect(mocks.requestAnalytics).toHaveBeenCalledWith(
      "capture-dashboard-panel",
      { dashboardId: "growth", panelId: "wau", filters: { timeRange: "90d" } },
      expect.anything(),
      58_000,
    );
    expect(result.status).toBe("captured");
    if (result.status !== "captured") return;
    expect(result.blockId).toMatch(/^analytics-chart-[a-f0-9]{8}$/);
    expect(result.analyticsChartTag).toContain("<AnalyticsChart");
    expect(result.analyticsChartTag).toContain(`id="${result.blockId}"`);
    expect(mocks.track).toHaveBeenCalledWith(
      "analytics_chart_captured",
      expect.objectContaining({
        panel_type: "line",
        page_visibility: "private",
        dashboard_visibility: "org",
        audience_verdict: "ok",
      }),
      undefined,
    );
  });

  it("hands the editor the numbers and an agent the tag, never both", async () => {
    const forEditor = await captureAnalyticsChart.run(
      { documentId: "doc_1", link: LINK, purpose: "insert" },
      { caller: "frontend" },
    );
    expect(forEditor).toMatchObject({ status: "captured", chart: chart() });
    expect(forEditor).not.toHaveProperty("analyticsChartTag");

    const forAgent = await captureAnalyticsChart.run(
      { documentId: "doc_1", link: LINK, purpose: "insert" },
      { caller: "tool", maxResultChars: 75_000 },
    );
    expect(forAgent).not.toHaveProperty("chart");
    expect(forAgent).toHaveProperty("analyticsChartTag");
  });

  it("fails clearly when the tag won't fit what the agent keeps", async () => {
    await expect(
      captureAnalyticsChart.run(
        { documentId: "doc_1", link: LINK, purpose: "insert" },
        { caller: "tool", maxResultChars: 200 },
      ),
    ).rejects.toMatchObject({
      errorCode: "analytics_chart_too_large",
      statusCode: 413,
    });
  });

  it("accepts a link from the other Analytics lane", async () => {
    await captureAnalyticsChart.run({
      documentId: "doc_1",
      link: "https://analytics.beta.example.test/dashboards/growth?tile=wau",
      purpose: "insert",
    });
    expect(mocks.requestAnalytics).toHaveBeenCalledWith(
      "capture-dashboard-panel",
      { dashboardId: "growth", panelId: "wau" },
      expect.anything(),
      58_000,
    );
  });

  it("refreshes a chart in place under its block id", async () => {
    const result = await captureAnalyticsChart.run({
      documentId: "doc_1",
      dashboardId: "growth",
      panelId: "wau",
      filters: { timeRange: "30d" },
      purpose: "refresh",
      blockId: "analytics-chart-1a2b3c4d",
    });
    expect(mocks.requestAnalytics).toHaveBeenCalledWith(
      "capture-dashboard-panel",
      { dashboardId: "growth", panelId: "wau", filters: { timeRange: "30d" } },
      expect.anything(),
      58_000,
    );
    expect(result.blockId).toBe("analytics-chart-1a2b3c4d");
    expect(mocks.track).toHaveBeenCalledWith(
      "analytics_chart_refreshed",
      expect.anything(),
      undefined,
    );
  });

  it("refuses links from anywhere but this workspace's Analytics", async () => {
    await expect(
      failureOf(
        captureAnalyticsChart.run({
          documentId: "doc_1",
          link: "https://evil.example/dashboards/growth?tile=wau",
          purpose: "insert",
        }),
      ),
    ).resolves.toEqual({
      errorCode: "analytics_chart_link_invalid",
      statusCode: 400,
    });
    expect(mocks.requestAnalytics).not.toHaveBeenCalled();
  });

  it("refuses someone who can only read the page, before asking Analytics", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("private", "viewer"));
    await expect(
      failureOf(
        captureAnalyticsChart.run({
          documentId: "doc_1",
          link: LINK,
          purpose: "insert",
        }),
      ),
    ).resolves.toEqual({
      errorCode: "analytics_chart_edit_required",
      statusCode: 403,
    });
    expect(mocks.requestAnalytics).not.toHaveBeenCalled();
  });

  it("refuses signed-out and public readers", async () => {
    for (const email of [
      undefined,
      "public-0f8fad5b-d9cb-469f-a165-70867728950e@agent-native.local",
    ]) {
      mocks.userEmail = email;
      await expect(
        failureOf(
          captureAnalyticsChart.run({
            documentId: "doc_1",
            link: LINK,
            purpose: "insert",
          }),
        ),
      ).resolves.toEqual({
        errorCode: "analytics_chart_signed_out",
        statusCode: 401,
      });
    }
    expect(mocks.resolveDocumentAccess).not.toHaveBeenCalled();
  });

  it("reads a page in Trash, or one the caller can't open, as missing", async () => {
    const trashed = page("private");
    trashed.resource.trashedAt = "2026-11-01T00:00:00Z" as never;
    for (const access of [null, trashed]) {
      mocks.resolveDocumentAccess.mockResolvedValue(access);
      await expect(
        failureOf(
          captureAnalyticsChart.run({
            documentId: "doc_1",
            link: LINK,
            purpose: "insert",
          }),
        ),
      ).resolves.toEqual({ errorCode: "document_not_found", statusCode: 404 });
    }
    expect(mocks.requestAnalytics).not.toHaveBeenCalled();
  });

  it("passes on Analytics' refusal as the editor's own", async () => {
    mocks.requestAnalytics.mockResolvedValue({
      ok: false,
      code: "analytics_refused",
      message: "Dashboard not found",
    });
    await expect(
      captureAnalyticsChart.run({
        documentId: "doc_1",
        link: LINK,
        purpose: "insert",
      }),
    ).rejects.toMatchObject({
      message: "Dashboard not found",
      errorCode: "analytics_refused",
      statusCode: 409,
    });
  });

  it("asks first when more people can open the page than the dashboard", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("org"));
    mocks.requestAnalytics.mockResolvedValue({
      ok: true,
      data: chart({ visibility: "private" }),
    });
    const held = await captureAnalyticsChart.run({
      documentId: "doc_1",
      link: LINK,
      purpose: "insert",
    });
    expect(held.status).toBe("needs_confirmation");
    expect(held).not.toHaveProperty("analyticsChartTag");

    const confirmed = await captureAnalyticsChart.run({
      documentId: "doc_1",
      link: LINK,
      purpose: "insert",
      acknowledgeWiderAudience: true,
    });
    expect(confirmed.status).toBe("captured");
  });

  it("counts a private page shared with a colleague as open to the organization", async () => {
    mocks.shares = [
      { principalType: "user", principalId: "colleague@example.test" },
    ];
    mocks.requestAnalytics.mockResolvedValue({
      ok: true,
      data: chart({ visibility: "private" }),
    });
    const held = await captureAnalyticsChart.run({
      documentId: "doc_1",
      link: LINK,
      purpose: "insert",
    });
    expect(held.status).toBe("needs_confirmation");
    mocks.requestAnalytics.mockResolvedValue({
      ok: true,
      data: chart({ visibility: "org" }),
    });
    const fits = await captureAnalyticsChart.run({
      documentId: "doc_1",
      link: LINK,
      purpose: "insert",
    });
    expect(fits.status).toBe("captured");
  });

  it("counts a page shared with someone outside the organization as open to everyone", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("org"));
    mocks.shares = [
      { principalType: "user", principalId: "guest@elsewhere.test" },
    ];
    mocks.requestAnalytics.mockResolvedValue({
      ok: true,
      data: chart({ visibility: "org" }),
    });
    await expect(
      captureAnalyticsChart.run({
        documentId: "doc_1",
        link: LINK,
        purpose: "insert",
        acknowledgeWiderAudience: true,
      }),
    ).rejects.toMatchObject({
      errorCode: "analytics_chart_wider_than_dashboard",
      details: { reason: "public-page" },
    });
  });

  it("never puts a narrower dashboard's panel in a public page", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("public"));
    await expect(
      captureAnalyticsChart.run({
        documentId: "doc_1",
        link: LINK,
        purpose: "insert",
        acknowledgeWiderAudience: true,
      }),
    ).rejects.toMatchObject({
      errorCode: "analytics_chart_wider_than_dashboard",
      statusCode: 409,
      details: { reason: "public-page", panelType: "line" },
    });
  });

  it("never lets a table reach more people than its dashboard", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("org"));
    mocks.requestAnalytics.mockResolvedValue({
      ok: true,
      data: chart({ visibility: "private", type: "table" }),
    });
    await expect(
      captureAnalyticsChart.run({
        documentId: "doc_1",
        link: LINK,
        purpose: "insert",
        acknowledgeWiderAudience: true,
      }),
    ).rejects.toMatchObject({
      errorCode: "analytics_chart_wider_than_dashboard",
      details: { reason: "wider", panelType: "table" },
    });
  });
});

describe("get-analytics-chart-status", () => {
  it("lets an editor see each dashboard's sharing and panel fingerprints", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("org"));
    const status = {
      dashboard: { id: "growth", title: "Growth", visibility: "org" },
      panels: [{ id: "wau", fingerprint: "ba9876543210", type: "line" }],
    };
    mocks.requestAnalytics
      .mockResolvedValueOnce({ ok: true, data: status })
      .mockResolvedValueOnce({
        ok: false,
        code: "analytics_refused",
        message: "Dashboard not found",
      });
    await expect(
      getAnalyticsChartStatus.run({
        documentId: "doc_1",
        dashboards: [
          { dashboardId: "growth", panelIds: ["wau"] },
          { dashboardId: "secret", panelIds: [] },
        ],
      }),
    ).resolves.toEqual({
      dashboards: [
        { dashboardId: "growth", status },
        { dashboardId: "secret", error: "Dashboard not found" },
      ],
    });
    expect(mocks.requestAnalytics).toHaveBeenCalledWith(
      "get-dashboard-panel-status",
      { dashboardId: "growth", panelIds: ["wau"] },
      expect.anything(),
      15_000,
    );
  });

  it("asks Analytics nothing for someone who can only read the page", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("org", "viewer"));
    await expect(
      failureOf(
        getAnalyticsChartStatus.run({
          documentId: "doc_1",
          dashboards: [{ dashboardId: "growth", panelIds: [] }],
        }),
      ),
    ).resolves.toMatchObject({ statusCode: 403 });
    expect(mocks.requestAnalytics).not.toHaveBeenCalled();
  });

  it("asks Analytics nothing for someone who can't open the page", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(null);
    await expect(
      failureOf(
        getAnalyticsChartStatus.run({
          documentId: "doc_1",
          dashboards: [{ dashboardId: "growth", panelIds: [] }],
        }),
      ),
    ).resolves.toEqual({ errorCode: "document_not_found", statusCode: 404 });
    expect(mocks.requestAnalytics).not.toHaveBeenCalled();
  });
});

describe("get-analytics-links", () => {
  it("says where Analytics is and which links turn into charts", async () => {
    await expect(getAnalyticsLinks.run({})).resolves.toEqual({
      appUrl: "https://analytics.example.test",
      linkOrigins: [
        "https://analytics.example.test",
        "https://analytics.beta.example.test",
      ],
    });
  });
});
