import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  body: { source: "clay" } as { source?: string },
  ctx: { userEmail: "user@example.test", orgId: "org-example" },
  resolveAnalyticsProviderCredential: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  readBody: vi.fn(async () => mocks.body),
}));

vi.mock("../../lib/credentials", () => ({
  resolveCredential: vi.fn(),
  withRequestContextFromEvent: vi.fn(
    async (_event: unknown, run: (ctx: typeof mocks.ctx) => Promise<unknown>) =>
      run(mocks.ctx),
  ),
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

describe("test-connection Clay credentials", () => {
  beforeEach(() => {
    mocks.body = { source: "clay" };
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
});
