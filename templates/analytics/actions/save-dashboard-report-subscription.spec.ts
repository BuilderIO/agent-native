import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "owner@example.com",
}));
vi.mock("../server/lib/dashboard-report-subscriptions", () => ({
  MAX_DASHBOARD_REPORT_RECIPIENTS: 5,
  saveDashboardReportSubscription: vi.fn(),
}));

const action = (await import("./save-dashboard-report-subscription")).default;

describe("save-dashboard-report-subscription schema", () => {
  it("accepts duplicate valid addresses so the service can normalize them", () => {
    const recipients = Array.from({ length: 6 }, () => "person@example.com");

    const result = action.schema.safeParse({
      dashboardId: "dashboard_1",
      recipients,
      timeOfDay: "04:00",
      timezone: "America/Los_Angeles",
      enabled: true,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.recipients).toEqual(recipients);
  });
});
