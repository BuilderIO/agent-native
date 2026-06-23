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
const { createGitHubRepoFilesAction } =
  await import("./actions/github-repo-files.js");
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

  it("tries legacy Google OAuth credentials before deleting grants after a client rotation", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "new-google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "new-google-client-secret");
    vi.stubEnv("GOOGLE_LEGACY_CLIENT_ID", "legacy-google-client-id");
    vi.stubEnv("GOOGLE_LEGACY_CLIENT_SECRET", "legacy-google-client-secret");
    listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "docs@example.com",
        displayName: "Docs Account",
        tokens: {
          access_token: "expired-docs-access-token",
          refresh_token: "old-client-refresh-token",
          expiry_date: Date.now() - 60_000,
        },
      },
    ]);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "unauthorized_client" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "legacy-refreshed-access-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ files: [] }), {
          status: 200,
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

    await runtime.executeRequest({
      provider: "google_drive",
      path: "/files",
    });

    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      "client_id=new-google-client-id",
    );
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
      "client_id=legacy-google-client-id",
    );
    expect(deleteOAuthTokens).not.toHaveBeenCalledWith(
      "google-docs",
      "docs@example.com",
    );
    expect(saveOAuthTokens).toHaveBeenCalledWith(
      "google-docs",
      "docs@example.com",
      expect.objectContaining({
        access_token: "legacy-refreshed-access-token",
      }),
      "ada@example.com",
    );
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

  it("lists GitHub repository files through the provider credential resolver", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tree: [
              {
                path: "packages/core/src/provider-api/index.ts",
                type: "blob",
                size: 42,
                sha: "file-sha",
                url: "https://api.github.com/blob/file-sha",
              },
              {
                path: "packages/core/src/provider-api",
                type: "tree",
                sha: "tree-sha",
              },
              {
                path: "README.md",
                type: "blob",
                size: 12,
                sha: "readme-sha",
              },
            ],
            truncated: false,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    const lookups: any[] = [];
    const runtime = createProviderApiRuntime({
      appId: "headless",
      providerIds: ["github"],
      getCredentialContext: () => credentialContext,
      resolveCredential: async (lookup) => {
        lookups.push(lookup);
        return {
          key: lookup.key,
          value: "github-token",
          source: "test",
          provider: lookup.provider,
        };
      },
    });

    const result = await runtime.listGitHubRepositoryFiles({
      owner: "BuilderIO",
      repo: "agent-native.git",
      path: "packages/core/src/provider-api",
      recursive: true,
      connectionId: "conn-github",
    });

    expect(result).toMatchObject({
      repository: { owner: "BuilderIO", repo: "agent-native" },
      ref: "main",
      recursive: true,
      totalCount: 1,
      truncated: false,
      entries: [
        {
          path: "packages/core/src/provider-api/index.ts",
          type: "file",
          sha: "file-sha",
        },
      ],
    });
    expect(lookups).toEqual([
      expect.objectContaining({
        appId: "headless",
        provider: "github",
        workspaceProvider: "github",
        key: "GITHUB_TOKEN",
        connectionId: "conn-github",
      }),
      expect.objectContaining({
        appId: "headless",
        provider: "github",
        workspaceProvider: "github",
        key: "GITHUB_TOKEN",
        connectionId: "conn-github",
      }),
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/BuilderIO/agent-native/git/trees/main?recursive=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer github-token",
          Accept: "application/vnd.github+json",
        }),
      }),
    );
  });

  it("reads and decodes GitHub repository file contents", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "file",
          name: "README.md",
          path: "README.md",
          sha: "readme-sha",
          size: 8,
          encoding: "base64",
          content: Buffer.from("# Hello\n", "utf8").toString("base64"),
          url: "https://api.github.com/repos/o/r/contents/README.md",
          html_url: "https://github.com/o/r/blob/main/README.md",
          download_url: "https://raw.githubusercontent.com/o/r/main/README.md",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const runtime = createProviderApiRuntime({
      appId: "headless",
      providerIds: ["github"],
      getCredentialContext: () => credentialContext,
      resolveCredential: async ({ key, provider }) => ({
        key,
        value: "github-token",
        source: "test",
        provider,
      }),
    });

    const result = await runtime.readGitHubRepositoryFile({
      owner: "o",
      repo: "r",
      path: "README.md",
      ref: "main",
    });

    expect(result).toMatchObject({
      path: "README.md",
      sha: "readme-sha",
      encoding: "base64",
      content: "# Hello\n",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/contents/README.md?ref=main",
      expect.anything(),
    );
  });

  it("writes GitHub repository files through the contents API", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: {
            name: "hello world.txt",
            path: "docs/hello world.txt",
            sha: "new-content-sha",
            url: "https://api.github.com/repos/o/r/contents/docs/hello%20world.txt",
            html_url:
              "https://github.com/o/r/blob/feature/docs/hello%20world.txt",
          },
          commit: {
            sha: "commit-sha",
            url: "https://api.github.com/repos/o/r/git/commits/commit-sha",
            html_url: "https://github.com/o/r/commit/commit-sha",
            message: "Update docs",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const runtime = createProviderApiRuntime({
      appId: "headless",
      providerIds: ["github"],
      getCredentialContext: () => credentialContext,
      resolveCredential: async ({ key, provider }) => ({
        key,
        value: "github-token",
        source: "test",
        provider,
      }),
    });

    const result = await runtime.writeGitHubRepositoryFile({
      owner: "o",
      repo: "r",
      path: "docs/hello world.txt",
      content: "hello from provider api",
      message: "Update docs",
      branch: "feature",
      sha: "old-content-sha",
      committer: { name: "Ada", email: "ada@example.com" },
    });

    expect(result).toMatchObject({
      path: "docs/hello world.txt",
      content: { sha: "new-content-sha" },
      commit: { sha: "commit-sha", message: "Update docs" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/contents/docs/hello%20world.txt",
      expect.objectContaining({ method: "PUT" }),
    );
    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      message: "Update docs",
      branch: "feature",
      sha: "old-content-sha",
      committer: { name: "Ada", email: "ada@example.com" },
    });
    expect(body.content).toBe(
      Buffer.from("hello from provider api", "utf8").toString("base64"),
    );
  });

  it("deletes GitHub repository files through the contents API", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: null,
          commit: {
            sha: "delete-commit-sha",
            url: "https://api.github.com/repos/o/r/git/commits/delete-commit-sha",
            html_url: "https://github.com/o/r/commit/delete-commit-sha",
            message: "Delete docs",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const runtime = createProviderApiRuntime({
      appId: "headless",
      providerIds: ["github"],
      getCredentialContext: () => credentialContext,
      resolveCredential: async ({ key, provider }) => ({
        key,
        value: "github-token",
        source: "test",
        provider,
      }),
    });

    const result = await runtime.deleteGitHubRepositoryFile({
      owner: "o",
      repo: "r",
      path: "docs/old.md",
      message: "Delete docs",
      branch: "feature",
      sha: "old-content-sha",
    });

    expect(result).toMatchObject({
      path: "docs/old.md",
      branch: "feature",
      commit: { sha: "delete-commit-sha", message: "Delete docs" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/contents/docs/old.md",
      expect.objectContaining({ method: "DELETE" }),
    );
    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      message: "Delete docs",
      branch: "feature",
      sha: "old-content-sha",
    });
  });

  it("creates a reusable github-repo-files action with approval for writes and deletes", async () => {
    const runtime = {
      listGitHubRepositoryFiles: vi.fn(),
      searchGitHubRepositoryFiles: vi.fn(),
      readGitHubRepositoryFile: vi.fn().mockResolvedValue({ ok: true }),
      writeGitHubRepositoryFile: vi.fn(),
      deleteGitHubRepositoryFile: vi.fn(),
    };
    const action = createGitHubRepoFilesAction(runtime);

    expect(typeof action.needsApproval).toBe("function");
    await expect(
      Promise.resolve(
        (action.needsApproval as any)({
          operation: "write",
          owner: "o",
          repo: "r",
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      Promise.resolve(
        (action.needsApproval as any)({
          operation: "delete",
          owner: "o",
          repo: "r",
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      Promise.resolve(
        (action.needsApproval as any)({
          operation: "read",
          owner: "o",
          repo: "r",
        }),
      ),
    ).resolves.toBe(false);

    await action.run({
      operation: "read",
      owner: "o",
      repo: "r",
      path: "a.ts",
    });

    expect(runtime.readGitHubRepositoryFile).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      path: "a.ts",
      ref: undefined,
      connectionId: undefined,
      timeoutMs: undefined,
      maxBytes: undefined,
    });

    await action.run({
      operation: "write",
      owner: "o",
      repo: "r",
      path: "a.ts",
      content: "export const value = 1;\n",
      message: "Update a.ts",
    });

    expect(runtime.writeGitHubRepositoryFile).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      path: "a.ts",
      content: "export const value = 1;\n",
      message: "Update a.ts",
      branch: undefined,
      sha: undefined,
      overwriteExisting: true,
      committer: undefined,
      author: undefined,
      connectionId: undefined,
      timeoutMs: undefined,
      maxBytes: undefined,
    });
  });
});
