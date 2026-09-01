import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canAuthorizeBuilderApiRequest,
  hasBuilderApiCredentialCustody,
  resolveBuilderApiAuthorization,
  resolveBuilderRequestAuthorization,
} from "./builder-api-auth.js";

const getBuilderOAuthSessionMock = vi.hoisted(() => vi.fn());
const hasBuilderOAuthSessionMock = vi.hoisted(() => vi.fn());
const resolveBuilderCredentialMock = vi.hoisted(() => vi.fn());
const listRemoteServersMock = vi.hoisted(() => vi.fn());
const toHttpServerConfigAsyncMock = vi.hoisted(() => vi.fn());
const readMcpOAuthCredentialsMock = vi.hoisted(() => vi.fn());
const CredentialStoreUnavailableErrorMock = vi.hoisted(
  () =>
    class CredentialStoreUnavailableError extends Error {
      readonly errorCode = "credential_store_unavailable";
      readonly retryable = true;

      constructor(cause?: unknown) {
        super("Credential store unavailable", { cause });
        this.name = "CredentialStoreUnavailableError";
      }
    },
);
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getRequestOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock("./builder-oauth.js", () => ({
  getBuilderOAuthSession: getBuilderOAuthSessionMock,
  hasBuilderOAuthSession: hasBuilderOAuthSessionMock,
}));
vi.mock("./credential-provider.js", () => ({
  CredentialStoreUnavailableError: CredentialStoreUnavailableErrorMock,
  resolveBuilderCredential: resolveBuilderCredentialMock,
}));
vi.mock("../mcp-client/remote-store.js", () => ({
  listRemoteServers: listRemoteServersMock,
  toHttpServerConfigAsync: toHttpServerConfigAsyncMock,
}));
vi.mock("../mcp-client/oauth-client.js", () => ({
  readMcpOAuthCredentials: readMcpOAuthCredentialsMock,
}));
vi.mock("./request-context.js", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
  getRequestOrgId: getRequestOrgIdMock,
}));

const ASSETS_WRITE = "builder:assets:write";
const PUBLISH_ISSUER = "https://mcp.builder.io";

function publishCredentials(issuer = PUBLISH_ISSUER) {
  return {
    serverUrl: "https://mcp.builder.io/mcp/publish",
    clientInformation: { client_id: "builder-client", issuer },
    discoveryState: {
      authorizationServerUrl: issuer,
      authorizationServerMetadata: { issuer },
      resourceMetadata: {
        resource: "https://mcp.builder.io/mcp/publish",
        authorization_servers: [issuer],
      },
    },
    tokens: {
      access_token: "publish-oauth-token",
      scope: "mcp:publish:read",
      issuer,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getRequestUserEmailMock.mockReturnValue("user@example.com");
  getRequestOrgIdMock.mockReturnValue(undefined);
  hasBuilderOAuthSessionMock.mockResolvedValue(false);
  getBuilderOAuthSessionMock.mockResolvedValue(null);
  resolveBuilderCredentialMock.mockResolvedValue(null);
  listRemoteServersMock.mockResolvedValue([]);
  toHttpServerConfigAsyncMock.mockResolvedValue({});
  readMcpOAuthCredentialsMock.mockResolvedValue(null);
});

describe("resolveBuilderApiAuthorization", () => {
  it("uses the OAuth token when the grant carries the required scope", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockResolvedValue({
      accessToken: "<OAUTH_TOKEN_EXAMPLE>",
      scopes: ["builder:ai:invoke", ASSETS_WRITE],
    });
    resolveBuilderCredentialMock.mockResolvedValue("bpk-legacy");

    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).resolves.toBe(
      "Bearer <OAUTH_TOKEN_EXAMPLE>",
    );
    expect(getBuilderOAuthSessionMock).toHaveBeenCalledWith(
      "user@example.com",
      null,
      ASSETS_WRITE,
    );
    // OAuth wins outright — the legacy key is never even consulted.
    expect(resolveBuilderCredentialMock).not.toHaveBeenCalled();
  });

  it("names the missing scope instead of falling back to a legacy key", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockResolvedValue({
      accessToken: "<OAUTH_TOKEN_EXAMPLE>",
      scopes: ["builder:ai:invoke"],
    });
    resolveBuilderCredentialMock.mockResolvedValue("bpk-legacy");

    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).rejects.toThrow(
      /needs re-authorizing to grant builder:assets:write/,
    );
    // Falling back here would let a deploy-level key act for a user who never
    // authorized it.
    expect(resolveBuilderCredentialMock).not.toHaveBeenCalled();
  });

  it("asks for re-authorization when custody exists but no session resolves", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockResolvedValue(null);
    resolveBuilderCredentialMock.mockResolvedValue("bpk-legacy");

    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).rejects.toThrow(
      /access expired/,
    );
  });

  it("reports a retryable error when the OAuth session read is unavailable", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockRejectedValue({
      code: "ECHECKOUTTIMEOUT",
    });

    await expect(
      resolveBuilderApiAuthorization(ASSETS_WRITE),
    ).rejects.toBeInstanceOf(CredentialStoreUnavailableErrorMock);
  });

  it("reports a retryable error when the OAuth custody read is unavailable", async () => {
    hasBuilderOAuthSessionMock.mockRejectedValue({
      code: "ECHECKOUTTIMEOUT",
    });

    await expect(
      resolveBuilderApiAuthorization(ASSETS_WRITE),
    ).rejects.toBeInstanceOf(CredentialStoreUnavailableErrorMock);
  });

  it("uses the legacy private key when there is no OAuth grant", async () => {
    resolveBuilderCredentialMock.mockResolvedValue("bpk-legacy");

    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).resolves.toBe(
      "Bearer bpk-legacy",
    );
  });

  it("reports not connected when neither credential kind answers", async () => {
    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).rejects.toThrow(
      /not connected/,
    );
  });

  // The grant is org-scoped, so a recording that finalizes after the user
  // switched active org must still authorize against its own org.
  it("binds the lookup to the request organization, not the active one", async () => {
    getRequestOrgIdMock.mockReturnValue("org-recording");
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockResolvedValue({
      accessToken: "<OAUTH_TOKEN_EXAMPLE>",
      scopes: ["builder:ai:invoke", ASSETS_WRITE],
    });

    await resolveBuilderApiAuthorization(ASSETS_WRITE);

    expect(hasBuilderOAuthSessionMock).toHaveBeenCalledWith(
      "user@example.com",
      "org-recording",
    );
    expect(getBuilderOAuthSessionMock).toHaveBeenCalledWith(
      "user@example.com",
      "org-recording",
      ASSETS_WRITE,
    );
  });

  it("skips the OAuth lookup with no request owner", async () => {
    getRequestUserEmailMock.mockReturnValue(undefined);
    resolveBuilderCredentialMock.mockResolvedValue("bpk-deploy");

    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).resolves.toBe(
      "Bearer bpk-deploy",
    );
    expect(hasBuilderOAuthSessionMock).not.toHaveBeenCalled();
  });
});

describe("resolveBuilderRequestAuthorization", () => {
  it("uses the org-scoped Publish MCP grant for database reads", async () => {
    getRequestOrgIdMock.mockReturnValue("org-1");
    listRemoteServersMock.mockImplementation(async (scope, scopeId) =>
      scope === "org" && scopeId === "org-1"
        ? [
            {
              id: "builder-publish",
              name: "Builder.io",
              url: "https://mcp.builder.io/mcp/publish",
              oauthSecretKey: "builder-publish-oauth",
            },
          ]
        : [],
    );
    toHttpServerConfigAsyncMock.mockResolvedValue({
      headers: { Authorization: "Bearer publish-oauth-token" },
    });
    readMcpOAuthCredentialsMock.mockResolvedValue(publishCredentials());

    await expect(
      resolveBuilderRequestAuthorization({ oauthResource: "publish" }),
    ).resolves.toEqual({
      token: "publish-oauth-token",
      authorization: "Bearer publish-oauth-token",
      source: "oauth",
    });
    expect(hasBuilderOAuthSessionMock).not.toHaveBeenCalled();
    expect(resolveBuilderCredentialMock).not.toHaveBeenCalled();
  });

  it("accepts the refresh scope returned with a read-only Publish grant", async () => {
    getRequestOrgIdMock.mockReturnValue("org-1");
    listRemoteServersMock.mockResolvedValue([
      {
        id: "builder-publish",
        name: "Builder.io",
        url: "https://mcp.builder.io/mcp/publish",
        oauthSecretKey: "builder-publish-oauth",
      },
    ]);
    const credentials = publishCredentials();
    credentials.tokens.scope = "mcp:publish:read offline_access";
    readMcpOAuthCredentialsMock.mockResolvedValue(credentials);
    toHttpServerConfigAsyncMock.mockResolvedValue({
      headers: { Authorization: "Bearer publish-oauth-token" },
    });

    await expect(
      resolveBuilderRequestAuthorization({ oauthResource: "publish" }),
    ).resolves.toMatchObject({
      source: "oauth",
      authorization: "Bearer publish-oauth-token",
    });
  });

  it("does not fall back when Publish OAuth custody needs reconnecting", async () => {
    getRequestOrgIdMock.mockReturnValue("org-1");
    listRemoteServersMock.mockResolvedValue([
      {
        id: "builder-publish",
        name: "Builder.io",
        url: "https://mcp.builder.io/mcp/publish",
        oauthSecretKey: "builder-publish-oauth",
      },
    ]);
    readMcpOAuthCredentialsMock.mockResolvedValue(publishCredentials());
    toHttpServerConfigAsyncMock.mockResolvedValue({ headers: {} });
    resolveBuilderCredentialMock.mockResolvedValue("legacy-key");

    await expect(
      resolveBuilderRequestAuthorization({ oauthResource: "publish" }),
    ).rejects.toThrow(/Publish access expired/);
    expect(resolveBuilderCredentialMock).not.toHaveBeenCalled();
  });

  it("rejects a personal Publish grant instead of consuming or bypassing it", async () => {
    getRequestOrgIdMock.mockReturnValue("org-1");
    listRemoteServersMock.mockImplementation(async (scope) =>
      scope === "user"
        ? [
            {
              id: "personal-builder-publish",
              name: "Builder.io",
              url: "https://mcp.builder.io/mcp/publish",
              oauthSecretKey: "personal-builder-publish-oauth",
            },
          ]
        : [],
    );
    resolveBuilderCredentialMock.mockResolvedValue("legacy-key");

    await expect(
      resolveBuilderRequestAuthorization({ oauthResource: "publish" }),
    ).rejects.toThrow(/connected only for this user/);
    expect(readMcpOAuthCredentialsMock).not.toHaveBeenCalled();
    expect(resolveBuilderCredentialMock).not.toHaveBeenCalled();
  });

  it("rejects an OAuth token whose issuer is not the Builder Publish issuer", async () => {
    getRequestOrgIdMock.mockReturnValue("org-1");
    listRemoteServersMock.mockResolvedValue([
      {
        id: "builder-publish",
        name: "Builder.io",
        url: "https://mcp.builder.io/mcp/publish",
        oauthSecretKey: "builder-publish-oauth",
      },
    ]);
    readMcpOAuthCredentialsMock.mockResolvedValue(
      publishCredentials("https://attacker.example.com"),
    );
    resolveBuilderCredentialMock.mockResolvedValue("legacy-key");

    await expect(
      resolveBuilderRequestAuthorization({ oauthResource: "publish" }),
    ).rejects.toThrow(/needs re-authorizing/);
    expect(toHttpServerConfigAsyncMock).not.toHaveBeenCalled();
    expect(resolveBuilderCredentialMock).not.toHaveBeenCalled();
  });

  it("rejects a Publish grant that also carries write scope", async () => {
    getRequestOrgIdMock.mockReturnValue("org-1");
    listRemoteServersMock.mockResolvedValue([
      {
        id: "builder-publish",
        name: "Builder.io",
        url: "https://mcp.builder.io/mcp/publish",
        oauthSecretKey: "builder-publish-oauth",
      },
    ]);
    const credentials = publishCredentials();
    credentials.tokens.scope = "mcp:publish:read mcp:publish:write";
    readMcpOAuthCredentialsMock.mockResolvedValue(credentials);
    resolveBuilderCredentialMock.mockResolvedValue("legacy-key");

    await expect(
      resolveBuilderRequestAuthorization({ oauthResource: "publish" }),
    ).rejects.toThrow(/needs re-authorizing/);
    expect(toHttpServerConfigAsyncMock).not.toHaveBeenCalled();
    expect(resolveBuilderCredentialMock).not.toHaveBeenCalled();
  });

  it("returns OAuth provenance for Settings and authenticated provider reads", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockResolvedValue({
      accessToken: "<OAUTH_TOKEN_EXAMPLE>",
      scopes: ["builder:ai:invoke"],
    });

    await expect(
      resolveBuilderRequestAuthorization({
        requiredScope: "builder:ai:invoke",
        legacyCredentialKeys: [
          "BUILDER_PRIVATE_KEY",
          "BUILDER_CMS_PRIVATE_KEY",
        ],
      }),
    ).resolves.toEqual({
      token: "<OAUTH_TOKEN_EXAMPLE>",
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
    });
    expect(resolveBuilderCredentialMock).not.toHaveBeenCalled();
  });

  it("keeps the Content legacy alias inside the shared fallback boundary", async () => {
    resolveBuilderCredentialMock.mockImplementation(async (key: string) =>
      key === "BUILDER_CMS_PRIVATE_KEY" ? "cms-private-key" : null,
    );

    await expect(
      resolveBuilderRequestAuthorization({
        legacyCredentialKeys: [
          "BUILDER_PRIVATE_KEY",
          "BUILDER_CMS_PRIVATE_KEY",
        ],
      }),
    ).resolves.toMatchObject({
      token: "cms-private-key",
      source: "legacy",
      legacyCredentialKey: "BUILDER_CMS_PRIVATE_KEY",
    });
    expect(resolveBuilderCredentialMock.mock.calls).toEqual([
      ["BUILDER_PRIVATE_KEY"],
      ["BUILDER_CMS_PRIVATE_KEY"],
    ]);
  });
});

describe("canAuthorizeBuilderApiRequest", () => {
  it("requires the requested scope for OAuth credentials", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockResolvedValue({
      accessToken: "<OAUTH_TOKEN_EXAMPLE>",
      scopes: ["builder:ai:invoke"],
    });

    await expect(canAuthorizeBuilderApiRequest(ASSETS_WRITE)).resolves.toBe(
      false,
    );
    expect(getBuilderOAuthSessionMock).toHaveBeenCalledWith(
      "user@example.com",
      null,
      ASSETS_WRITE,
    );
  });

  it("accepts a legacy private key", async () => {
    resolveBuilderCredentialMock.mockResolvedValue("bpk-legacy");

    await expect(canAuthorizeBuilderApiRequest(ASSETS_WRITE)).resolves.toBe(
      true,
    );
  });
});

describe("hasBuilderApiCredentialCustody", () => {
  // The reported bug: storage gates only knew about private keys, so every
  // OAuth-only connection was treated as having no storage at all.
  it("counts an OAuth grant with no private key as connected", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    resolveBuilderCredentialMock.mockResolvedValue(null);

    await expect(hasBuilderApiCredentialCustody()).resolves.toBe(true);
  });

  it("counts a narrow OAuth grant as connected so the upload path can explain", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);

    await expect(hasBuilderApiCredentialCustody()).resolves.toBe(true);
    expect(resolveBuilderCredentialMock).not.toHaveBeenCalled();
  });

  it("counts a legacy private key as connected", async () => {
    resolveBuilderCredentialMock.mockResolvedValue("bpk-legacy");

    await expect(hasBuilderApiCredentialCustody()).resolves.toBe(true);
  });

  it("is false when nothing is connected", async () => {
    await expect(hasBuilderApiCredentialCustody()).resolves.toBe(false);
  });
});
