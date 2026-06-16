import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCredential = vi.fn();
const isBlockedExtensionUrlWithDns = vi.fn();
const createSsrfSafeDispatcher = vi.fn();
const listOAuthAccountsByOwner = vi.fn();
const saveOAuthTokens = vi.fn();
const deleteOAuthTokens = vi.fn();

vi.mock("../credentials/index.js", () => ({
  resolveCredential,
}));

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
}));

vi.mock("../oauth-tokens/index.js", () => ({
  deleteOAuthTokens,
  listOAuthAccountsByOwner,
  saveOAuthTokens,
}));

const { createProviderApiRuntime } = await import("./index.js");

const credentialContext = {
  userEmail: "ada@example.com",
  orgId: "org-1",
};

describe("provider API runtime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resolveCredential.mockReset();
    isBlockedExtensionUrlWithDns.mockReset();
    createSsrfSafeDispatcher.mockReset();
    listOAuthAccountsByOwner.mockReset();
    saveOAuthTokens.mockReset();
    deleteOAuthTokens.mockReset();
    vi.unstubAllEnvs();
    isBlockedExtensionUrlWithDns.mockResolvedValue(false);
    createSsrfSafeDispatcher.mockResolvedValue(null);
    resolveCredential.mockResolvedValue(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("enforces provider allowlists for specific catalog lookups", async () => {
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
    });

    await expect(runtime.listCatalog("gmail")).rejects.toThrow(
      /Provider API gmail is not enabled/,
    );
  });

  it("does not fall back after a custom credential resolver returns null", async () => {
    resolveCredential.mockResolvedValue("local-token");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
      resolveCredential: async () => null,
    });

    await expect(
      runtime.executeRequest({
        provider: "hubspot",
        path: "/crm/v3/objects/deals",
      }),
    ).rejects.toThrow(/hubspot credential not configured/);

    expect(resolveCredential).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wraps provider transport failures with a sanitized request target", async () => {
    resolveCredential.mockResolvedValue("hubspot-token");
    const err = new TypeError("fetch failed") as TypeError & {
      cause?: { code: string; message: string };
    };
    err.cause = {
      code: "ECONNRESET",
      message: "socket closed while using hubspot-token",
    };
    vi.spyOn(globalThis, "fetch").mockRejectedValue(err);
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
    });

    await expect(
      runtime.executeRequest({
        provider: "hubspot",
        path: "/crm/v3/objects/deals",
      }),
    ).rejects.toThrow(
      /Provider API request failed \(ECONNRESET\): GET api\.hubapi\.com\/crm\/v3\/objects\/deals: socket closed while using \[redacted\]/,
    );
  });

  it("retries without the SSRF dispatcher when Node rejects the dispatcher implementation", async () => {
    resolveCredential.mockResolvedValue("hubspot-token");
    createSsrfSafeDispatcher.mockResolvedValue({ dispatch: vi.fn() });
    const err = new TypeError("fetch failed") as TypeError & {
      cause?: { code: string; message: string };
    };
    err.cause = {
      code: "UND_ERR_INVALID_ARG",
      message: "invalid onRequestStart method",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockRejectedValueOnce(err).mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [{ id: "deal-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
    });

    const result = await runtime.executeRequest({
      provider: "hubspot",
      path: "/crm/v3/objects/deals",
    });

    expect(result).toMatchObject({
      response: { status: 200, json: { results: [{ id: "deal-1" }] } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      dispatcher: expect.anything(),
    });
    expect(fetchMock.mock.calls[1]?.[1]).not.toHaveProperty("dispatcher");
  });

  it("allows templates to override the OAuth provider for built-in provider APIs", async () => {
    listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "docs@example.com",
        displayName: "Docs Account",
        tokens: {
          access_token: "docs-access-token",
          expiry_date: Date.now() + 60_000,
        },
      },
    ]);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const runtime = createProviderApiRuntime({
      appId: "slides",
      providerIds: ["google_drive"],
      getCredentialContext: () => credentialContext,
      oauthProviderOverrides: {
        google_drive: "google-docs",
      },
    });

    await runtime.executeRequest({
      provider: "google_drive",
      path: "/files",
    });

    expect(listOAuthAccountsByOwner).toHaveBeenCalledWith(
      "google-docs",
      credentialContext.userEmail,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer docs-access-token",
        }),
      }),
    );
  });

  it("does not duplicate provider base path segments when callers include them", async () => {
    resolveCredential.mockImplementation(async (key: string) =>
      key === "GONG_API_BASE" ? null : "gong-token",
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["gong"],
      getCredentialContext: () => credentialContext,
    });

    await runtime.executeRequest({
      provider: "gong",
      path: "/v2/users",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.gong.io/v2/users",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      }),
    );
  });

  it("deletes stale Google OAuth grants after permanent refresh failures", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
    listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "docs@example.com",
        displayName: "Docs Account",
        tokens: {
          access_token: "expired-docs-access-token",
          refresh_token: "dead-refresh-token",
          expiry_date: Date.now() - 60_000,
        },
      },
    ]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const runtime = createProviderApiRuntime({
      appId: "slides",
      providerIds: ["google_drive"],
      getCredentialContext: () => credentialContext,
      oauthProviderOverrides: {
        google_drive: "google-docs",
      },
    });

    await expect(
      runtime.executeRequest({
        provider: "google_drive",
        path: "/files",
      }),
    ).rejects.toThrow(/Google OAuth refresh failed: invalid_grant/);

    expect(deleteOAuthTokens).toHaveBeenCalledWith(
      "google-docs",
      "docs@example.com",
    );
    expect(saveOAuthTokens).not.toHaveBeenCalled();
  });

  it("rejects paginated requests with both query and body cursor methods", async () => {
    resolveCredential.mockResolvedValue("hubspot-token");
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
    });

    await expect(
      runtime.executeRequest({
        provider: "hubspot",
        path: "/crm/v3/objects/deals",
        fetchAllPages: {
          cursorPath: "paging.next.after",
          cursorParam: "after",
          cursorBodyPath: "after",
        },
      }),
    ).rejects.toThrow(/exactly one cursor method/);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("stops paginated requests when a page returns an HTTP error", async () => {
    resolveCredential.mockResolvedValue("hubspot-token");
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ id: "deal-1" }],
            paging: { next: { after: "next-page" } },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      );
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
    });

    await expect(
      runtime.executeRequest({
        provider: "hubspot",
        path: "/crm/v3/objects/deals",
        fetchAllPages: {
          cursorPath: "paging.next.after",
          cursorParam: "after",
          itemsPath: "results",
        },
      }),
    ).rejects.toThrow(/HTTP 429.*rate limited/);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
