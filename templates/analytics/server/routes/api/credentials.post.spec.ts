import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteCredential: vi.fn(),
  deleteResolvedCredential: vi.fn(),
  readBody: vi.fn(),
  installBuiltinDashboardOnce: vi.fn(),
  getCredentialContextFromEvent: vi.fn(),
  resolveOrgRole: vi.fn(),
  saveCredential: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  readBody: mocks.readBody,
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  setResponseStatus: vi.fn(),
}));
vi.mock("../../lib/credentials", () => ({
  deleteCredential: mocks.deleteCredential,
  deleteResolvedCredential: mocks.deleteResolvedCredential,
  getCredentialContextFromEvent: mocks.getCredentialContextFromEvent,
  saveCredential: mocks.saveCredential,
}));
vi.mock("../../lib/db-admin-connections", () => ({
  resolveOrgRole: mocks.resolveOrgRole,
}));
vi.mock("../../lib/builtin-dashboards", () => ({
  installBuiltinDashboardOnce: mocks.installBuiltinDashboardOnce,
}));

const { default: handler } = await import("./credentials.post");

describe("POST /api/credentials", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.resolveOrgRole.mockResolvedValue("owner");
    mocks.getCredentialContextFromEvent.mockResolvedValue({
      userEmail: "ada@example.com",
      orgId: "org-1",
    });
  });

  it.each([
    {
      role: "member",
      requestedScope: undefined,
      orgId: "org-1",
      dashboardOrgId: null,
    },
    {
      role: "owner",
      requestedScope: "user",
      orgId: "org-1",
      dashboardOrgId: null,
    },
    {
      role: "owner",
      requestedScope: undefined,
      orgId: "org-1",
      dashboardOrgId: "org-1",
    },
    {
      role: "admin",
      requestedScope: "org",
      orgId: "org-1",
      dashboardOrgId: "org-1",
    },
    {
      role: "member",
      requestedScope: undefined,
      orgId: null,
      dashboardOrgId: null,
    },
  ])(
    "installs GA in the saved credential scope: $role, $requestedScope, $orgId",
    async ({ role, requestedScope, orgId, dashboardOrgId }) => {
      mocks.resolveOrgRole.mockResolvedValue(role);
      mocks.getCredentialContextFromEvent.mockResolvedValue({
        userEmail: "ada@example.com",
        orgId,
      });
      mocks.readBody.mockResolvedValue({
        scope: requestedScope,
        vars: [{ key: "GA4_PROPERTY_ID", value: "1234" }],
      });

      await handler({} as any);

      expect(mocks.installBuiltinDashboardOnce).toHaveBeenCalledExactlyOnceWith(
        { email: "ada@example.com", orgId: dashboardOrgId },
        "google-analytics",
      );
      expect(mocks.saveCredential).toHaveBeenCalledExactlyOnceWith(
        "GA4_PROPERTY_ID",
        "1234",
        {
          userEmail: "ada@example.com",
          orgId,
          scope: dashboardOrgId ? "org" : "user",
        },
      );
    },
  );

  it("does not install a GA dashboard after an unauthorized org save", async () => {
    mocks.resolveOrgRole.mockResolvedValue("member");
    mocks.readBody.mockResolvedValue({
      scope: "org",
      vars: [{ key: "GA4_PROPERTY_ID", value: "1234" }],
    });

    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 403 });

    expect(mocks.saveCredential).not.toHaveBeenCalled();
    expect(mocks.installBuiltinDashboardOnce).not.toHaveBeenCalled();
  });

  it("clears an owner's Personal optional key from their own row only", async () => {
    mocks.readBody.mockResolvedValue({
      scope: "user",
      vars: [
        { key: "BIGQUERY_PROJECT_ID", value: "example-project" },
        { key: "ANALYTICS_BIGQUERY_EVENTS_TABLE", value: "" },
      ],
    });

    await handler({} as any);

    expect(mocks.deleteCredential).toHaveBeenCalledWith(
      "ANALYTICS_BIGQUERY_EVENTS_TABLE",
      { userEmail: "ada@example.com", orgId: "org-1", scope: "user" },
    );
    expect(mocks.deleteResolvedCredential).not.toHaveBeenCalled();
  });
});
