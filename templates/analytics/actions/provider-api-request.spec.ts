import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCredential = vi.fn();
const requireRequestCredentialContext = vi.fn();
const resolveAnalyticsProviderCredential = vi.fn();
const isBlockedExtensionUrlWithDns = vi.fn();
const createSsrfSafeDispatcher = vi.fn();
const getAccessToken = vi.fn();
const signRs256Jwt = vi.fn();

vi.mock("../server/lib/credentials", () => ({
  resolveCredential,
}));

vi.mock("../server/lib/credentials-context", () => ({
  requireRequestCredentialContext,
}));

vi.mock("../server/lib/provider-credentials", () => ({
  resolveAnalyticsProviderCredential,
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
}));

vi.mock("../server/lib/gcloud", () => ({
  getAccessToken,
}));

vi.mock("../server/lib/sign-jwt", () => ({
  signRs256Jwt,
}));

const { default: providerApiCatalog } = await import("./provider-api-catalog");
const { default: providerApiRequest } = await import("./provider-api-request");

describe("provider API escape hatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resolveCredential.mockReset();
    requireRequestCredentialContext.mockReset();
    resolveAnalyticsProviderCredential.mockReset();
    isBlockedExtensionUrlWithDns.mockReset();
    createSsrfSafeDispatcher.mockReset();
    getAccessToken.mockReset();
    signRs256Jwt.mockReset();

    requireRequestCredentialContext.mockReturnValue({
      userEmail: "ada@example.com",
      orgId: "org-1",
    });
    isBlockedExtensionUrlWithDns.mockResolvedValue(false);
    createSsrfSafeDispatcher.mockResolvedValue(null);
    resolveCredential.mockResolvedValue(null);
    resolveAnalyticsProviderCredential.mockResolvedValue(null);
  });

  it("lists provider docs, examples, and auth metadata without secrets", async () => {
    const result = (await providerApiCatalog.run({
      provider: "hubspot",
    })) as Record<string, any>;

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]).toMatchObject({
      id: "hubspot",
      auth: "bearer",
      credentialKeys: ["HUBSPOT_PRIVATE_APP_TOKEN", "HUBSPOT_ACCESS_TOKEN"],
    });
    expect(result.providers[0].docsUrls[0]).toContain("hubspot");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("makes arbitrary authenticated provider requests and redacts secrets", async () => {
    resolveAnalyticsProviderCredential.mockResolvedValue({
      value: "hub-token",
      key: "HUBSPOT_PRIVATE_APP_TOKEN",
      provider: "hubspot",
      source: "workspace_connection",
      connectionId: "conn-1",
      connectionLabel: "Team HubSpot",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, echo: "hub-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = (await providerApiRequest.run({
      provider: "hubspot",
      method: "POST",
      path: "/crm/v3/objects/deals/search",
      query: { archived: false },
      body: {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "products",
                operator: "CONTAINS_TOKEN",
                value: "Publish",
              },
            ],
          },
        ],
      },
      connectionId: "conn-1",
    })) as Record<string, any>;

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.hubapi.com/crm/v3/objects/deals/search?archived=false",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer hub-token",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(result.request.credentialSources[0]).toMatchObject({
      key: "HUBSPOT_PRIVATE_APP_TOKEN",
      source: "workspace_connection",
      connectionId: "conn-1",
    });
    expect(resolveAnalyticsProviderCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "hubspot",
        keys: ["HUBSPOT_PRIVATE_APP_TOKEN"],
        connectionId: "conn-1",
      }),
    );
    expect(result.response.json).toEqual({ ok: true, echo: "[redacted]" });
    expect(JSON.stringify(result)).not.toContain("hub-token");
  });

  it("rejects absolute URLs outside the provider host", async () => {
    await expect(
      providerApiRequest.run({
        provider: "hubspot",
        method: "GET",
        path: "https://example.com/crm/v3/objects/deals",
      }),
    ).rejects.toThrow(/provider host/i);
  });
});
