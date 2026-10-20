import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openDashboard: vi.fn(),
  getReviewedDashboard: vi.fn(),
}));

vi.mock("./open-dashboard.js", () => ({
  openDashboard: mocks.openDashboard,
}));
vi.mock("./dashboard-review-access.js", () => ({
  getReviewedDashboard: mocks.getReviewedDashboard,
}));

const { dashboardAnnotationScope } =
  await import("./dashboard-annotation-scope");

const viewer = { email: "Viewer@example.test", orgId: "org-viewer" };

describe("dashboardAnnotationScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openDashboard.mockResolvedValue(null);
  });

  it("reads a dashboard shared from another organization in that organization", async () => {
    const shared = { ownerEmail: "owner@example.test", orgId: "org-owner" };
    mocks.openDashboard.mockResolvedValue({ saved: shared });
    await expect(dashboardAnnotationScope("shared", viewer)).resolves.toEqual({
      scope: { email: "owner@example.test", orgId: "org-owner" },
      editable: false,
      dashboard: shared,
    });
    expect(mocks.openDashboard).toHaveBeenCalledWith("shared", viewer);
  });

  it("lets a member change the annotations of their organization's dashboard", async () => {
    mocks.openDashboard.mockResolvedValue({
      saved: { ownerEmail: "teammate@example.test", orgId: "org-viewer" },
    });
    await expect(dashboardAnnotationScope("team", viewer)).resolves.toEqual({
      scope: { email: "teammate@example.test", orgId: "org-viewer" },
      editable: true,
    });
  });

  it("matches a personal dashboard's owner by email, in any case", async () => {
    const personal = { email: "viewer@example.test", orgId: null };
    mocks.openDashboard.mockResolvedValue({
      saved: { ownerEmail: "VIEWER@example.test", orgId: null },
    });
    await expect(
      dashboardAnnotationScope("mine", personal),
    ).resolves.toMatchObject({ editable: true });
    await expect(
      dashboardAnnotationScope("mine", viewer),
    ).resolves.toMatchObject({ editable: false });
  });

  it("reads a reviewed dashboard through the Human Review check, not the reviewer's own access", async () => {
    const customer = {
      kind: "sql",
      ownerEmail: "owner@example.test",
      orgId: "org-customer",
    };
    mocks.getReviewedDashboard.mockResolvedValue(customer);
    const review = { reviewOrgId: "org-customer" };
    await expect(
      dashboardAnnotationScope("customer", viewer, review),
    ).resolves.toEqual({
      scope: { email: "owner@example.test", orgId: "org-customer" },
      editable: false,
      dashboard: customer,
    });
    expect(mocks.getReviewedDashboard).toHaveBeenCalledWith(
      "customer",
      "org-viewer",
      "org-customer",
    );
    expect(mocks.openDashboard).not.toHaveBeenCalled();

    mocks.getReviewedDashboard.mockResolvedValue(null);
    await expect(
      dashboardAnnotationScope("customer", viewer, review),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("reads a built-in in the caller's scope", async () => {
    mocks.openDashboard.mockResolvedValue({
      builtin: { id: "builtin-demo-node-exporter" },
    });
    await expect(
      dashboardAnnotationScope("builtin-demo-node-exporter", viewer),
    ).resolves.toEqual({ scope: viewer, editable: true });
  });

  it("fails for a dashboard the caller can't open, without reading anyone's annotations", async () => {
    await expect(
      dashboardAnnotationScope("someone-elses", viewer),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
