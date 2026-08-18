import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initCrmDataPrograms: vi.fn(),
  resolve: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@agent-native/core/dashboard-storage", () => ({
  createProgramPanelSourceResolver: () => ({ resolve: mocks.resolve }),
}));

vi.mock("../server/db/index.js", () => ({
  crmDashboardStore: { get: mocks.get },
}));

vi.mock("../server/lib/provider-api.js", () => ({
  CRM_APP_ID: "crm",
}));

vi.mock("./_crm-data-program-actions.js", () => ({
  initCrmDataPrograms: mocks.initCrmDataPrograms,
}));

vi.mock("./_crm-dashboard.js", () => ({
  requireDashboardAccess: vi.fn(() => ({ userEmail: "owner@example.com" })),
}));

describe("get-crm-dashboard-panel", () => {
  beforeEach(() => {
    mocks.initCrmDataPrograms.mockReset();
    mocks.resolve.mockReset();
    mocks.get.mockReset();
  });

  it("registers the CRM data-program action before resolving a panel", async () => {
    mocks.get.mockResolvedValue({
      config: {
        panels: [
          {
            id: "pipeline-total",
            source: "program",
            query: '{"programId":"dp_pipeline"}',
          },
        ],
      },
    });
    mocks.resolve.mockResolvedValue({ rows: [] });

    const { default: action } = await import("./get-crm-dashboard-panel.js");
    await action.run(
      { dashboardId: "dashboard_1", panelId: "pipeline-total" },
      { userEmail: "owner@example.com" },
    );

    expect(mocks.initCrmDataPrograms).toHaveBeenCalledOnce();
    expect(mocks.resolve).toHaveBeenCalledWith(
      {
        source: "program",
        query: '{"programId":"dp_pipeline"}',
      },
      { userEmail: "owner@example.com", orgId: null },
    );
    expect(mocks.initCrmDataPrograms.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resolve.mock.invocationCallOrder[0],
    );
  });
});
