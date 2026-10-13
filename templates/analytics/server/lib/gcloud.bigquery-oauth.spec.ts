import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  credentialContext: {
    userEmail: "analyst@example.com",
    orgId: "customer-org",
  } as { userEmail: string; orgId: string | null; credentialScope?: "org" },
  requestContext: {} as Record<string, unknown>,
  resolveCredential: vi.fn(),
  resolveAnalyticsProviderCredential: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: () => mocks.credentialContext,
  getRequestContext: () => mocks.requestContext,
}));

vi.mock("./credentials", () => ({
  resolveCredential: mocks.resolveCredential,
}));

vi.mock("./provider-credentials", () => ({
  resolveAnalyticsProviderCredential: mocks.resolveAnalyticsProviderCredential,
}));

const { getBigQueryAccessToken } = await import("./gcloud");

describe("getBigQueryAccessToken", () => {
  beforeEach(() => {
    mocks.credentialContext = {
      userEmail: "analyst@example.com",
      orgId: "customer-org",
    };
    mocks.requestContext = {};
    mocks.resolveCredential.mockReset();
    mocks.resolveCredential.mockResolvedValue("warehouse-project");
    mocks.resolveAnalyticsProviderCredential.mockReset();
    mocks.resolveAnalyticsProviderCredential.mockResolvedValue({
      value: "user-oauth-token",
      key: "BIGQUERY_ACCESS_TOKEN",
      provider: "bigquery",
      source: "workspace_connection",
    });
  });

  it("resolves the project and personal grant once per request", async () => {
    await expect(getBigQueryAccessToken()).resolves.toBe("user-oauth-token");
    await expect(getBigQueryAccessToken()).resolves.toBe("user-oauth-token");

    expect(mocks.resolveCredential).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAnalyticsProviderCredential).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a personal grant across requests", async () => {
    await getBigQueryAccessToken();
    mocks.requestContext = {};
    await getBigQueryAccessToken();

    expect(mocks.resolveAnalyticsProviderCredential).toHaveBeenCalledTimes(2);
  });
});
