import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ctx: { userEmail: "member@example.test", orgId: "org-1" },
  resolveAnalyticsProviderCredential: vi.fn(),
}));

vi.mock("./credentials-context", () => ({
  requireRequestCredentialContext: vi.fn(() => mocks.ctx),
  scopedCredentialCacheKey: vi.fn((key: string) => `org-1:${key}`),
}));

vi.mock("./provider-credentials", () => ({
  HUBSPOT_ANALYTICS_CREDENTIAL_KEYS: [
    "HUBSPOT_PRIVATE_APP_TOKEN",
    "HUBSPOT_ACCESS_TOKEN",
  ],
  resolveAnalyticsProviderCredential: mocks.resolveAnalyticsProviderCredential,
}));

const { getDealPipelines } = await import("./hubspot");

describe("HubSpot native client", () => {
  beforeEach(() => {
    mocks.resolveAnalyticsProviderCredential.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("uses a granted workspace OAuth bearer token", async () => {
    mocks.resolveAnalyticsProviderCredential.mockResolvedValue({
      value: "hubspot-oauth-token",
      key: "HUBSPOT_OAUTH_TOKEN",
      provider: "hubspot",
      source: "workspace_connection",
      connectionId: "hubspot-connection",
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(getDealPipelines()).resolves.toEqual([]);

    expect(mocks.resolveAnalyticsProviderCredential).toHaveBeenCalledWith({
      provider: "hubspot",
      keys: ["HUBSPOT_PRIVATE_APP_TOKEN", "HUBSPOT_ACCESS_TOKEN"],
      ctx: mocks.ctx,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.hubapi.com/crm/v3/pipelines/deals",
      {
        headers: { Authorization: "Bearer hubspot-oauth-token" },
      },
    );
  });
});
