import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteCredential: vi.fn(),
  deleteResolvedCredential: vi.fn(),
  readBody: vi.fn(),
  resolveOrgRole: vi.fn(),
  saveCredential: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  readBody: mocks.readBody,
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  setResponseStatus: vi.fn(),
}));
vi.mock("../../lib/credentials", () => ({
  deleteCredential: mocks.deleteCredential,
  deleteResolvedCredential: mocks.deleteResolvedCredential,
  getCredentialContextFromEvent: async () => ({
    userEmail: "ada@example.com",
    orgId: "org-1",
  }),
  saveCredential: mocks.saveCredential,
}));
vi.mock("../../lib/db-admin-connections", () => ({
  resolveOrgRole: mocks.resolveOrgRole,
}));
vi.mock("../../lib/dashboard-seeds", () => ({ loadDashboardSeed: vi.fn() }));
vi.mock("../../lib/scoped-settings", () => ({
  getScopedSettingRecord: vi.fn(),
  putScopedSettingRecord: vi.fn(),
  resolveSettingsScope: vi.fn(),
}));

const { default: handler } = await import("./credentials.post");

describe("POST /api/credentials", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.resolveOrgRole.mockResolvedValue("owner");
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
