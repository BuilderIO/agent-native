import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasCredential: vi.fn(),
  resolveBigQueryOAuthCredential: vi.fn(),
  isFeatureFlagEnabled: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  buildDeepLink: vi.fn(),
}));

vi.mock("@agent-native/core/credentials", () => ({
  hasCredential: mocks.hasCredential,
}));
vi.mock("../provider-credentials.js", () => ({
  resolveBigQueryOAuthCredential: mocks.resolveBigQueryOAuthCredential,
}));
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: mocks.isFeatureFlagEnabled,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
  buildDeepLink: mocks.buildDeepLink,
}));

const migration = await import("./sigma-migration.js");

describe("Sigma migration context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.getRequestUserEmail.mockReturnValue("user@example.com");
    mocks.isFeatureFlagEnabled.mockResolvedValue(true);
    mocks.hasCredential.mockResolvedValue(false);
    mocks.resolveBigQueryOAuthCredential.mockResolvedValue(null);
    mocks.buildDeepLink.mockReturnValue("/data-sources");
  });

  it("requires a signed-in user, active organization, and enabled flag", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    await expect(migration.requireSigmaMigrationContext()).rejects.toThrow(
      "Sign in to use Sigma dashboard migration.",
    );

    mocks.getRequestUserEmail.mockReturnValue("USER@example.com");
    mocks.getRequestOrgId.mockReturnValue(undefined);
    await expect(migration.requireSigmaMigrationContext()).rejects.toThrow(
      "Select an active organization to use Sigma dashboard migration.",
    );

    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.isFeatureFlagEnabled.mockResolvedValue(false);
    await expect(migration.requireSigmaMigrationContext()).rejects.toThrow(
      "Sigma dashboard migration is not enabled for this workspace.",
    );
    expect(mocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ key: "analytics.sigma-dashboard-migration" }),
      { userEmail: "user@example.com", orgId: "org-1" },
    );
  });

  it("requires a project and either service account credentials or BigQuery OAuth", async () => {
    const context = {
      email: "USER@example.com",
      userEmail: "user@example.com",
      orgId: "org-1",
    };
    mocks.hasCredential.mockImplementation(
      async (key: string) => key === "BIGQUERY_PROJECT_ID",
    );

    await expect(migration.hasAnalyticsBigQuerySource(context)).resolves.toBe(
      false,
    );

    mocks.resolveBigQueryOAuthCredential.mockResolvedValue({ value: "token" });
    await expect(migration.hasAnalyticsBigQuerySource(context)).resolves.toBe(
      true,
    );
    expect(mocks.hasCredential).toHaveBeenCalledWith("BIGQUERY_PROJECT_ID", {
      userEmail: "user@example.com",
      orgId: "org-1",
    });

    mocks.resolveBigQueryOAuthCredential.mockResolvedValue(null);
    mocks.hasCredential.mockResolvedValue(true);
    await expect(migration.hasAnalyticsBigQuerySource(context)).resolves.toBe(
      true,
    );
  });

  it("builds provider setup links without returning credentials", () => {
    expect(migration.sigmaMigrationSetupLink("sigma")).toBe("/data-sources");
    expect(mocks.buildDeepLink).toHaveBeenCalledWith({
      app: "dispatch",
      view: "overview",
    });
    mocks.buildDeepLink.mockClear();
    expect(migration.sigmaMigrationSetupLink("bigquery")).toBe("/data-sources");
    expect(mocks.buildDeepLink).toHaveBeenCalledWith({
      app: "analytics",
      view: "data-sources",
      to: "/data-sources?source=bigquery&returnTo=ask",
    });
  });
});
