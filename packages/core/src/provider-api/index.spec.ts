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
const { resetProviderQuotaStateForTests } = await import("./quota-governor.js");

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
    resetProviderQuotaStateForTests();
    vi.unstubAllEnvs();
    vi.stubEnv("AGENT_NATIVE_PROVIDER_API_PERSIST_COOLDOWNS", "0");
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

  it("extracts provider docs HTML into compact markdown content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<!doctype html><html><head><title>HubSpot Docs</title></head>
        <body><main><h1>Deals API</h1><p>Use after for pagination.</p><a href="/docs/api/crm/deals">Deals</a></main></body></html>`,
        {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    );
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
    });

    const result = (await runtime.fetchDocs({
      provider: "hubspot",
      url: "https://developers.hubspot.com/docs/api/crm/deals",
    })) as any;

    expect(result.response).toMatchObject({
      status: 200,
      contentType: "text/html; charset=utf-8",
    });
    expect(result.response.text).toBeUndefined();
    expect(result.content.mode).toBe("markdown");
    expect(result.content.title).toBeTruthy();
    expect(result.content.content).toContain("Deals API");
    expect(result.content.links).toEqual([
      {
        text: "Deals",
        url: "https://developers.hubspot.com/docs/api/crm/deals",
      },
    ]);
  });

  it("returns provider docs matches without the full raw HTML body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<!doctype html><html><body><main><p>GET /crm/v3/objects/deals lists deals.</p><p>POST /crm/v3/objects/deals creates deals.</p></main></body></html>`,
        {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/html" },
        },
      ),
    );
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
    });

    const result = (await runtime.fetchDocs({
      provider: "hubspot",
      url: "https://developers.hubspot.com/docs/api/crm/deals",
      responseMode: "matches",
      search: { regex: "\\b(GET|POST) /crm/v3/objects/deals\\b" },
    })) as any;

    expect(result.response.text).toBeUndefined();
    expect(result.content.mode).toBe("matches");
    expect(result.content.totalMatches).toBe(2);
    expect(result.content.matches[0].match).toBe("GET /crm/v3/objects/deals");
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

  it("retries provider 429s through the shared quota governor", async () => {
    resolveCredential.mockResolvedValue("hubspot-token");
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "0",
          },
        }),
      )
      .mockResolvedValueOnce(
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
  });

  it("deduplicates identical concurrent GET provider requests", async () => {
    resolveCredential.mockResolvedValue("hubspot-token");
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReset();
    let resolveFetch: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
    });

    const first = runtime.executeRequest({
      provider: "hubspot",
      path: "/crm/v3/objects/deals",
      query: { limit: 10 },
    });
    const second = runtime.executeRequest({
      provider: "hubspot",
      path: "/crm/v3/objects/deals",
      query: { limit: 10 },
    });
    resolveFetch(
      new Response(JSON.stringify({ results: [{ id: "deal-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const [a, b] = await Promise.all([first, second]);

    expect(a).toMatchObject({
      response: { status: 200, json: { results: [{ id: "deal-1" }] } },
    });
    expect(b).toMatchObject({
      response: { status: 200, json: { results: [{ id: "deal-1" }] } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a structured cooldown result when Retry-After exceeds the wait budget", async () => {
    resolveCredential.mockResolvedValue("hubspot-token");
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "daily limit" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "120",
        },
      }),
    );
    const runtime = createProviderApiRuntime({
      appId: "analytics",
      providerIds: ["hubspot"],
      getCredentialContext: () => credentialContext,
    });

    const first = (await runtime.executeRequest({
      provider: "hubspot",
      path: "/crm/v3/objects/deals",
    })) as Record<string, any>;
    const second = (await runtime.executeRequest({
      provider: "hubspot",
      path: "/crm/v3/objects/deals",
    })) as Record<string, any>;

    expect(first.response).toMatchObject({
      status: 429,
      json: { error: "provider_quota_exhausted", provider: "hubspot" },
      quota: { exhausted: true, providerId: "hubspot" },
    });
    expect(second.response).toMatchObject({
      status: 429,
      json: { error: "provider_quota_exhausted", provider: "hubspot" },
      quota: { exhausted: true, providerId: "hubspot" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
        new Response(JSON.stringify({ message: "provider failed" }), {
          status: 500,
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
    ).rejects.toThrow(/HTTP 500.*provider failed/);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
