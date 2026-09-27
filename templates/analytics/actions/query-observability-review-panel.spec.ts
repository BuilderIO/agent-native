import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentRequestUserIsOrgAdmin: vi.fn(),
  getDashboardForReview: vi.fn(),
  getRequestContext: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  resolveAnalyticsPanelSource: vi.fn(),
  runWithRequestContext: vi.fn(),
  superOrgId: undefined as string | undefined,
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    currentRequestUserIsOrgAdmin: mocks.currentRequestUserIsOrgAdmin,
    getAppConfig: () => ({ observability: { superOrgId: mocks.superOrgId } }),
    getRequestContext: mocks.getRequestContext,
    getRequestOrgId: mocks.getRequestOrgId,
    getRequestUserEmail: mocks.getRequestUserEmail,
    runWithRequestContext: mocks.runWithRequestContext,
  };
});

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboardForReview: mocks.getDashboardForReview,
}));

vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolveAnalyticsPanelSource,
}));

const { default: queryReviewPanel } =
  await import("./query-observability-review-panel");

function dashboard() {
  return {
    kind: "sql",
    orgId: "customer-org",
    config: {
      variables: { timeRange: "7d" },
      filters: [
        {
          id: "customer",
          type: "text",
          label: "Customer",
          default: "O'Brien",
        },
      ],
      panels: [
        {
          id: "panel-1",
          source: "bigquery",
          chartType: "bar",
          title: "Orders",
          width: 12,
          sql: "SELECT * FROM orders WHERE customer = '{{customer}}'",
        },
      ],
    },
  };
}

describe("query-observability-review-panel access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.superOrgId = undefined;
    mocks.getRequestOrgId.mockReturnValue("org-a");
    mocks.getRequestUserEmail.mockReturnValue("admin@example.com");
    mocks.getRequestContext.mockReturnValue({ requestId: "request-1" });
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);
    mocks.getDashboardForReview.mockResolvedValue(dashboard());
    mocks.resolveAnalyticsPanelSource.mockResolvedValue({
      rows: [{ total: 42 }],
      schema: [{ name: "total", type: "number" }],
    });
    mocks.runWithRequestContext.mockImplementation(
      async (_context: unknown, run: () => Promise<unknown>) => run(),
    );
  });

  it("rejects non-admins before reading a dashboard or running a query", async () => {
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(false);

    await expect(
      queryReviewPanel.run({ dashboardId: "dashboard-1", panelId: "panel-1" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.getDashboardForReview).not.toHaveBeenCalled();
    expect(mocks.resolveAnalyticsPanelSource).not.toHaveBeenCalled();
  });

  it("keeps ordinary admins within their organization and interpolates saved filters", async () => {
    await queryReviewPanel.run({
      dashboardId: "dashboard-1",
      panelId: "panel-1",
    });

    expect(mocks.getDashboardForReview).toHaveBeenCalledWith("dashboard-1", {
      kind: "organization",
      orgId: "org-a",
    });
    expect(mocks.resolveAnalyticsPanelSource).toHaveBeenCalledWith(
      {
        source: "bigquery",
        query: "SELECT * FROM orders WHERE customer = 'O''Brien'",
      },
      { userEmail: "admin@example.com", orgId: "customer-org" },
    );
  });

  it("uses the configured super-org scope and the artifact org's credentials", async () => {
    mocks.superOrgId = "org-a";

    await queryReviewPanel.run({
      dashboardId: "dashboard-1",
      panelId: "panel-1",
    });

    expect(mocks.getDashboardForReview).toHaveBeenCalledWith("dashboard-1", {
      kind: "super-organization",
    });
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      {
        requestId: "request-1",
        userEmail: "admin@example.com",
        orgId: "customer-org",
      },
      expect.any(Function),
    );
  });

  it("accepts only saved panel references and server-derived variables", () => {
    expect(queryReviewPanel.agentTool).toBe(false);
    expect(queryReviewPanel.readOnly).toBe(true);
    expect(
      queryReviewPanel.schema.safeParse({
        dashboardId: "dashboard-1",
        panelId: "panel-1",
        source: "bigquery",
        query: "SELECT * FROM secrets",
        variables: { customer: "not the stored default" },
      }).success,
    ).toBe(false);
  });
});
