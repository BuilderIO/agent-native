import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  body: { source: "clay" } as { source?: string },
  ctx: { userEmail: "user@example.test", orgId: "org-example" },
  executeProviderApiRequest: vi.fn(),
  assertCredentialCanReachEndpoint: vi.fn(),
  resolveCredential: vi.fn(),
  resolveCredentialDetailed: vi.fn(),
  resolveAnalyticsGongCredentials: vi.fn(),
  resolveAnalyticsProviderCredential: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  readBody: vi.fn(async () => mocks.body),
}));

vi.mock("../../lib/credentials", () => ({
  assertCredentialCanReachEndpoint: mocks.assertCredentialCanReachEndpoint,
  resolveCredential: mocks.resolveCredential,
  resolveCredentialDetailed: mocks.resolveCredentialDetailed,
  withRequestContextFromEvent: vi.fn(
    async (_event: unknown, run: (ctx: typeof mocks.ctx) => Promise<unknown>) =>
      run(mocks.ctx),
  ),
}));

vi.mock("../../lib/provider-api", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

vi.mock("../../lib/provider-credentials", () => ({
  CLAY_ANALYTICS_CREDENTIAL_KEYS: ["CLAY_PUBLIC_API_KEY"],
  HUBSPOT_ANALYTICS_CREDENTIAL_KEYS: [
    "HUBSPOT_PRIVATE_APP_TOKEN",
    "HUBSPOT_ACCESS_TOKEN",
  ],
  resolveAnalyticsGongCredentials: mocks.resolveAnalyticsGongCredentials,
  resolveAnalyticsProviderCredential: mocks.resolveAnalyticsProviderCredential,
}));

import handler from "./test-connection.post";

describe("test-connection", () => {
  beforeEach(() => {
    mocks.body = { source: "clay" };
    mocks.executeProviderApiRequest.mockReset();
    mocks.assertCredentialCanReachEndpoint.mockReset();
    mocks.resolveCredential.mockReset();
    mocks.resolveCredentialDetailed.mockReset();
    mocks.resolveAnalyticsGongCredentials.mockReset();
    mocks.resolveAnalyticsProviderCredential.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("resolves Clay through the scoped provider credential model", async () => {
    mocks.resolveAnalyticsProviderCredential.mockResolvedValue({
      value: "clay-example-token",
    });
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(handler({} as never)).resolves.toEqual({ ok: true });

    expect(mocks.resolveAnalyticsProviderCredential).toHaveBeenCalledWith({
      provider: "clay",
      keys: ["CLAY_PUBLIC_API_KEY"],
      ctx: mocks.ctx,
    });
    expect(fetch).toHaveBeenCalledWith("https://api.clay.com/public/v0/me", {
      headers: { "clay-api-key": "clay-example-token" },
    });
  });

  it("does not call Clay without a scoped credential", async () => {
    mocks.resolveAnalyticsProviderCredential.mockResolvedValue(null);

    await expect(handler({} as never)).resolves.toEqual({
      ok: false,
      error: "Missing Clay Public API key",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tests HubSpot with the shared OAuth-or-legacy credential resolver", async () => {
    mocks.body = { source: "hubspot" };
    mocks.resolveAnalyticsProviderCredential.mockResolvedValue({
      value: "hubspot-oauth-token",
      source: "workspace_connection",
      connectionId: "hubspot-connection",
    });
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(handler({} as never)).resolves.toEqual({ ok: true });

    expect(mocks.resolveAnalyticsProviderCredential).toHaveBeenCalledWith({
      provider: "hubspot",
      keys: ["HUBSPOT_PRIVATE_APP_TOKEN", "HUBSPOT_ACCESS_TOKEN"],
      ctx: mocks.ctx,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=1",
      {
        headers: { Authorization: "Bearer hubspot-oauth-token" },
      },
    );
  });

  it("does not call HubSpot without an OAuth or legacy credential", async () => {
    mocks.body = { source: "hubspot" };
    mocks.resolveAnalyticsProviderCredential.mockResolvedValue(null);

    await expect(handler({} as never)).resolves.toEqual({
      ok: false,
      error: "Missing HubSpot token",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks Grafana credential provenance before testing the configured endpoint", async () => {
    mocks.body = { source: "grafana" };
    const endpoint = {
      value: "https://grafana-member.example.test",
      scope: "user",
      scopeId: "user@example.test",
    };
    const token = {
      value: "org-grafana-token",
      scope: "org",
      scopeId: "org-example",
    };
    mocks.resolveCredentialDetailed.mockImplementation(async (key: string) =>
      key === "GRAFANA_URL" ? endpoint : token,
    );
    mocks.assertCredentialCanReachEndpoint.mockImplementation(() => {
      throw new Error(
        "Refusing to send GRAFANA_API_TOKEN to a user-scoped endpoint unless it is saved by the same user.",
      );
    });

    await expect(handler({} as never)).resolves.toEqual({
      ok: false,
      error:
        "Refusing to send GRAFANA_API_TOKEN to a user-scoped endpoint unless it is saved by the same user.",
    });

    expect(mocks.assertCredentialCanReachEndpoint).toHaveBeenCalledWith(
      endpoint,
      token,
      "GRAFANA_API_TOKEN",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects shared Gong credentials before testing a user-owned API endpoint", async () => {
    mocks.body = { source: "gong" };
    const endpoint = {
      value: "https://member-gong.example.test/v2",
      scope: "user",
      scopeId: "user@example.test",
    };
    const credentials = {
      accessKey: "gong-access-key-example",
      accessSecret: "gong-access-secret-example",
      sources: [
        {
          key: "GONG_ACCESS_KEY",
          provider: "gong",
          value: "gong-access-key-example",
          source: "analytics_local",
          scope: "org",
          scopeId: "org-example",
        },
        {
          key: "GONG_ACCESS_SECRET",
          provider: "gong",
          value: "gong-access-secret-example",
          source: "analytics_local",
          scope: "org",
          scopeId: "org-example",
        },
      ],
    };
    mocks.resolveCredentialDetailed.mockResolvedValue(endpoint);
    mocks.resolveAnalyticsGongCredentials.mockResolvedValue(credentials);
    mocks.assertCredentialCanReachEndpoint.mockImplementation(() => {
      throw new Error(
        "Refusing to send GONG_ACCESS_KEY to a user-scoped endpoint unless it is saved by the same user.",
      );
    });

    await expect(handler({} as never)).resolves.toEqual({
      ok: false,
      error:
        "Refusing to send GONG_ACCESS_KEY to a user-scoped endpoint unless it is saved by the same user.",
    });

    expect(mocks.resolveCredentialDetailed).toHaveBeenCalledWith(
      "GONG_API_BASE",
      mocks.ctx,
    );
    expect(mocks.assertCredentialCanReachEndpoint).toHaveBeenCalledWith(
      endpoint,
      credentials.sources[0],
      "GONG_ACCESS_KEY",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tests Mixpanel through the provider API substrate", async () => {
    mocks.body = { source: "mixpanel" };
    mocks.resolveCredential.mockImplementation(async (key: string) =>
      key === "MIXPANEL_PROJECT_ID" ? "12345" : "user:secret",
    );
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: { ok: true, status: 200 },
    });

    await expect(handler({} as never)).resolves.toEqual({ ok: true });

    expect(mocks.executeProviderApiRequest).toHaveBeenCalledWith({
      provider: "mixpanel",
      method: "GET",
      path: "/events/top",
      query: {
        type: "general",
        limit: 1,
        project_id: "{projectId}",
      },
    });
  });

  it("preserves Mixpanel connection errors", async () => {
    mocks.body = { source: "mixpanel" };
    mocks.resolveCredential.mockResolvedValue("configured");
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: { ok: false, status: 401, text: "Invalid credentials" },
    });

    await expect(handler({} as never)).resolves.toEqual({
      ok: false,
      error: "Mixpanel API error 401: Invalid credentials",
    });
  });

  it("tests PostHog through the provider API substrate", async () => {
    mocks.body = { source: "posthog" };
    mocks.resolveCredential.mockResolvedValue("configured");
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: { ok: true, status: 200 },
    });

    await expect(handler({} as never)).resolves.toEqual({ ok: true });

    expect(mocks.executeProviderApiRequest).toHaveBeenCalledWith({
      provider: "posthog",
      method: "GET",
      path: "/api/projects/{projectId}/",
    });
  });

  it("keeps missing provider credentials as a connection-test result", async () => {
    mocks.body = { source: "posthog" };
    mocks.resolveCredential.mockResolvedValue(null);

    await expect(handler({} as never)).resolves.toEqual({
      ok: false,
      error: "Missing credentials",
    });
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });
});
