import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  body: { source: "clay" } as { source?: string },
  ctx: { userEmail: "user@example.test", orgId: "org-example" },
  executeProviderApiRequest: vi.fn(),
  resolveCredential: vi.fn(),
  resolveAnalyticsProviderCredential: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  readBody: vi.fn(async () => mocks.body),
}));

vi.mock("../../lib/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
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
  resolveAnalyticsGongCredentials: vi.fn(),
  resolveAnalyticsProviderCredential: mocks.resolveAnalyticsProviderCredential,
}));

import handler from "./test-connection.post";

describe("test-connection", () => {
  beforeEach(() => {
    mocks.body = { source: "clay" };
    mocks.executeProviderApiRequest.mockReset();
    mocks.resolveCredential.mockReset();
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
