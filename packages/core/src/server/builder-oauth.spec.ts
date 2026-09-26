import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const startMock = vi.hoisted(() => vi.fn());
const finishMock = vi.hoisted(() => vi.fn());
const readMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const revokeMock = vi.hoisted(() => vi.fn());
const getAccessTokenMock = vi.hoisted(() => vi.fn());
const markReconnectMock = vi.hoisted(() => vi.fn());
const validateIssuerMock = vi.hoisted(() => vi.fn());
const getRawTokensMock = vi.hoisted(() => vi.fn());
const resolveOrgMock = vi.hoisted(() => vi.fn());

vi.mock("../mcp-client/oauth-client.js", () => ({
  startMcpOAuthAuthorization: startMock,
  finishMcpOAuthAuthorization: finishMock,
  readMcpOAuthCredentials: readMock,
  saveMcpOAuthCredentials: saveMock,
  revokeMcpOAuthCredentials: revokeMock,
  getMcpOAuthAccessToken: getAccessTokenMock,
  markMcpOAuthReconnectRequired: markReconnectMock,
  validateMcpOAuthCallbackIssuer: validateIssuerMock,
}));

vi.mock("../oauth-tokens/store.js", () => ({
  getOAuthTokens: getRawTokensMock,
}));

vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: resolveOrgMock,
}));

const isRestrictedMock = vi.hoisted(() => vi.fn(async () => false));

vi.mock("./personal-provider-key-policy.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./personal-provider-key-policy.js")
  >()),
  isPersonalProviderKeyUseRestricted: isRestrictedMock,
}));

import {
  BUILDER_OAUTH_ISSUER,
  BUILDER_OAUTH_RESOURCE,
  BUILDER_OAUTH_SCOPE,
  BUILDER_OAUTH_SCOPES,
  canRoleConnectPersonalBuilder,
  deleteBuilderOAuthSession,
  exchangeBuilderOAuthAuthorization,
  finishBuilderOAuthAuthorization,
  getBuilderOAuthConnectionScope,
  getBuilderOAuthGrants,
  getBuilderOAuthStoredScope,
  getBuilderOAuthSession,
  hasBuilderOAuthSession,
  hasStoredBuilderOAuthGrant,
  markBuilderOAuthReconnectRequired,
  resolveBuilderOAuthRequestAccess,
  saveBuilderOAuthCredentials,
  startBuilderOAuthAuthorization,
} from "./builder-oauth.js";

const ownerEmail = "alice@example.com";
const DEFAULT_ORG = "org-default";

const BASE_KEY = "builder-general-resource-v1";
function perOrgKey(orgId: string): string {
  const digest = createHash("sha256").update(orgId).digest("hex");
  return `${BASE_KEY}:o:${digest}`;
}

function perUserKey(email: string): string {
  const digest = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
  return `${BASE_KEY}:u:${digest}`;
}

function credentials(overrides: Record<string, unknown> = {}) {
  return {
    serverUrl: BUILDER_OAUTH_RESOURCE,
    clientInformation: {
      client_id: "<CLIENT_ID_EXAMPLE>",
      issuer: BUILDER_OAUTH_ISSUER,
    },
    discoveryState: {
      authorizationServerUrl: BUILDER_OAUTH_ISSUER,
      authorizationServerMetadata: { issuer: BUILDER_OAUTH_ISSUER },
      resourceMetadata: {
        resource: BUILDER_OAUTH_RESOURCE,
      },
    },
    tokens: {
      access_token: "<ACCESS_TOKEN_EXAMPLE>",
      refresh_token: "<REFRESH_TOKEN_EXAMPLE>",
      scope: BUILDER_OAUTH_SCOPE,
      issuer: BUILDER_OAUTH_ISSUER,
    },
    tokenExpiresAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

// Every save stamps when the grant was connected, so status can tell a fresh
// reconnect from the grant that was already there.
function savedCredentials(finished: ReturnType<typeof credentials>) {
  return { ...finished, connectedAt: expect.any(Number) };
}

beforeEach(() => {
  startMock.mockReset();
  finishMock.mockReset();
  readMock.mockReset();
  saveMock.mockReset();
  revokeMock.mockReset();
  getAccessTokenMock.mockReset();
  markReconnectMock.mockReset();
  markReconnectMock.mockResolvedValue(true);
  validateIssuerMock.mockReset();
  getRawTokensMock.mockReset();
  getRawTokensMock.mockResolvedValue(null);
  resolveOrgMock.mockReset();
  // Every user belongs to an org; individual tests override the org id.
  resolveOrgMock.mockResolvedValue(DEFAULT_ORG);
  isRestrictedMock.mockReset();
  isRestrictedMock.mockResolvedValue(false);
});

describe("Builder hosted user OAuth", () => {
  it("uses the exact fixed Builder contract and requests every Builder scope up front", () => {
    expect({
      issuer: BUILDER_OAUTH_ISSUER,
      resource: BUILDER_OAUTH_RESOURCE,
      scopes: BUILDER_OAUTH_SCOPES,
    }).toEqual({
      issuer: "https://mcp.builder.io",
      resource: "https://api.builder.io",
      scopes: [
        "builder:ai:invoke",
        "builder:agents:run",
        "builder:browser:connect",
        "builder:assets:write",
        "builder:projects:read",
        "builder:projects:write",
        "builder:designsystem:read",
        "builder:designsystem:write",
      ],
    });
    expect(BUILDER_OAUTH_SCOPES.join(" ")).not.toContain("offline_access");
  });

  it("starts public PKCE authorization with Builder's fixed resource and scope", async () => {
    startMock.mockResolvedValue({
      authorizationUrl: new URL("https://mcp.builder.io/oauth/authorize"),
      codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
      clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
      discoveryState: { authorizationServerUrl: BUILDER_OAUTH_ISSUER },
    });

    await expect(
      startBuilderOAuthAuthorization({
        ownerEmail,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
        state: "<STATE_EXAMPLE>",
      }),
    ).resolves.toEqual({
      authorizationUrl: "https://mcp.builder.io/oauth/authorize",
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: { authorizationServerUrl: BUILDER_OAUTH_ISSUER },
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });
    expect(startMock).toHaveBeenCalledWith({
      serverUrl: BUILDER_OAUTH_RESOURCE,
      redirectUrl: "https://app.example.com/_agent-native/builder/callback",
      state: "<STATE_EXAMPLE>",
      scope: BUILDER_OAUTH_SCOPES.join(" "),
      resourceMetadataUrl:
        "https://mcp.builder.io/.well-known/oauth-protected-resource/api",
    });
  });

  it("separates PKCE exchange from credential persistence", async () => {
    const finished = credentials();
    finishMock.mockResolvedValue({ credentials: finished });

    const exchanged = await exchangeBuilderOAuthAuthorization({
      ownerEmail,
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(exchanged).toEqual(finished);
    expect(saveMock).not.toHaveBeenCalled();

    await saveBuilderOAuthCredentials({
      ownerEmail,
      orgId: DEFAULT_ORG,
      role: "owner",
      credentials: exchanged,
    });
    expect(saveMock).toHaveBeenCalledWith({
      key: perOrgKey(DEFAULT_ORG),
      scope: "org",
      scopeId: DEFAULT_ORG,
      serverUrl: BUILDER_OAUTH_RESOURCE,
      credentials: savedCredentials(finished),
    });
  });

  it("stores a completed grant in the explicit normalized user custody slot", async () => {
    const finished = credentials();
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail: "Alice@Example.com ",
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith({
      key: perUserKey(ownerEmail),
      scope: "user",
      scopeId: ownerEmail,
      serverUrl: BUILDER_OAUTH_RESOURCE,
      credentials: savedCredentials(finished),
    });
    expect(validateIssuerMock).toHaveBeenCalledWith(
      finished.discoveryState,
      BUILDER_OAUTH_ISSUER,
    );
    expect(finishMock).toHaveBeenCalledWith(
      expect.objectContaining({ iss: BUILDER_OAUTH_ISSUER }),
    );
  });

  // Without this the grant's scopes would have to be guessed on every later
  // read, and a new two-scope grant is indistinguishable from a legacy one.
  it("records the requested scopes when the token response omits them", async () => {
    const finished = credentials({
      tokens: {
        access_token: "<ACCESS_TOKEN_EXAMPLE>",
        issuer: BUILDER_OAUTH_ISSUER,
      },
    });
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail,
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          tokens: expect.objectContaining({
            scope: BUILDER_OAUTH_SCOPES.join(" "),
          }),
        }),
      }),
    );
  });

  it("leaves a declared scope claim untouched", async () => {
    const finished = credentials({
      tokens: {
        access_token: "<ACCESS_TOKEN_EXAMPLE>",
        scope: BUILDER_OAUTH_SCOPE,
        issuer: BUILDER_OAUTH_ISSUER,
      },
    });
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail,
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: savedCredentials(finished) }),
    );
  });

  it("does not accept a completed exchange bound to another resource", async () => {
    const finished = credentials({
      serverUrl: "https://unrelated.example.com",
    });
    finishMock.mockResolvedValue({ credentials: finished });
    await expect(
      finishBuilderOAuthAuthorization({
        ownerEmail,
        code: "<AUTHORIZATION_CODE_EXAMPLE>",
        pending: {
          codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
          clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
          discoveryState: finished.discoveryState,
          redirectUri: "https://app.example.com/_agent-native/builder/callback",
        },
      }),
    ).rejects.toThrow("another resource");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("rejects a callback issuer mismatch before exchanging the code", async () => {
    const finished = credentials();
    validateIssuerMock.mockImplementation(() => {
      throw new Error("issuer mismatch");
    });

    await expect(
      finishBuilderOAuthAuthorization({
        ownerEmail,
        code: "<AUTHORIZATION_CODE_EXAMPLE>",
        iss: "https://unrelated.example.com",
        pending: {
          codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
          clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
          discoveryState: finished.discoveryState,
          redirectUri: "https://app.example.com/_agent-native/builder/callback",
        },
      }),
    ).rejects.toThrow("issuer mismatch");
    expect(finishMock).not.toHaveBeenCalled();
  });

  it("keys token-store lookups by the caller's org", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockResolvedValue(null);
    await hasBuilderOAuthSession("Bob@Example.com");
    expect(getRawTokensMock).toHaveBeenCalledWith(
      "mcp",
      perOrgKey("org-acme"),
      "org:org-acme",
    );
  });

  it("does not fall back to the active org when the caller has no org", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");

    await expect(hasBuilderOAuthSession(ownerEmail, null)).resolves.toBe(false);
    expect(getRawTokensMock).toHaveBeenCalledTimes(1);
    expect(getRawTokensMock).toHaveBeenCalledWith(
      "mcp",
      perUserKey(ownerEmail),
      "user:alice@example.com",
    );
  });

  it("does not treat an unreadable empty token bundle as OAuth custody", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-acme" ? {} : null,
    );

    await expect(hasBuilderOAuthSession(ownerEmail)).resolves.toBe(false);
  });

  it("does not treat a non-record token bundle as OAuth custody", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockResolvedValue("not-a-token-bundle");

    await expect(hasBuilderOAuthSession(ownerEmail)).resolves.toBe(false);
  });

  it("shares one org-scoped credential across members of the same org", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-acme" ? {} : null,
    );
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(credentials());

    await getBuilderOAuthSession("alice@example.com");
    await getBuilderOAuthSession("bob@example.com");

    const keys = getAccessTokenMock.mock.calls.map((c) => c[0].key);
    expect(keys).toEqual([perOrgKey("org-acme"), perOrgKey("org-acme")]);
    expect(getAccessTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "org", scopeId: "org-acme" }),
    );
  });

  it("stores a completed grant under the org scope when the connector has an org", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    const finished = credentials();
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail,
      role: "owner",
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith({
      key: perOrgKey("org-acme"),
      scope: "org",
      scopeId: "org-acme",
      serverUrl: BUILDER_OAUTH_RESOURCE,
      credentials: savedCredentials(finished),
    });
  });

  it("keeps member OAuth credentials in personal custody", async () => {
    const finished = credentials();
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail,
      orgId: "org-acme",
      role: "member",
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: perUserKey(ownerEmail),
        scope: "user",
        scopeId: ownerEmail,
      }),
    );
  });

  it("stores under the org captured at start, not the active org at callback", async () => {
    // A switched active org must not win over the org authorized at start.
    resolveOrgMock.mockResolvedValue("org-switched");
    const finished = credentials();
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail,
      orgId: "org-started",
      role: "owner",
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith({
      key: perOrgKey("org-started"),
      scope: "org",
      scopeId: "org-started",
      serverUrl: BUILDER_OAUTH_RESOURCE,
      credentials: savedCredentials(finished),
    });
    expect(resolveOrgMock).not.toHaveBeenCalled();
  });

  it("reports the requesting user's email even when the token is org-scoped", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-acme" ? {} : null,
    );
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(credentials());

    await expect(
      resolveBuilderOAuthRequestAccess({
        ownerEmail: "Bob@Example.com",
        requiredScope: BUILDER_OAUTH_SCOPE,
      }),
    ).resolves.toMatchObject({ ownerEmail: "bob@example.com" });
  });

  it("does not return a stored access token after reconnect is required", async () => {
    // reconnect_required lives on the credential now; the generic resolver
    // returns no token for it.
    getAccessTokenMock.mockResolvedValue(null);

    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
    expect(readMock).not.toHaveBeenCalled();
  });

  it("marks reconnect required for a revoked OAuth grant", async () => {
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-default" ? {} : null,
    );
    await markBuilderOAuthReconnectRequired(ownerEmail);
    expect(markReconnectMock).toHaveBeenCalledWith({
      key: perOrgKey(DEFAULT_ORG),
      scope: "org",
      scopeId: DEFAULT_ORG,
      serverUrl: BUILDER_OAUTH_RESOURCE,
    });
  });

  it("treats malformed Builder-owned custody as present so callers fail closed", async () => {
    getRawTokensMock.mockResolvedValue({ corrupt: true });
    readMock.mockResolvedValue(null);
    await expect(hasBuilderOAuthSession(ownerEmail)).resolves.toBe(true);
    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
  });

  it("accepts custody whose serverUrl was canonicalized with a trailing slash", async () => {
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(
      credentials({
        serverUrl: `${BUILDER_OAUTH_RESOURCE}/`,
      }),
    );
    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toMatchObject({
      accessToken: "<ACCESS_TOKEN_EXAMPLE>",
      scopes: [BUILDER_OAUTH_SCOPE],
    });
  });

  it("parses scopes for status and rejects an insufficient requested scope", async () => {
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(
      credentials({
        tokens: {
          access_token: "<ACCESS_TOKEN_EXAMPLE>",
          scope: "builder:ai:invoke builder:context:read",
          issuer: BUILDER_OAUTH_ISSUER,
        },
      }),
    );
    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toMatchObject({
      scopes: ["builder:ai:invoke", "builder:context:read"],
    });
    await expect(
      resolveBuilderOAuthRequestAccess({
        ownerEmail,
        requiredScope: "builder:assets:write",
      }),
    ).rejects.toThrow("does not grant builder:assets:write");
  });

  it("falls back to an org grant when a personal grant lacks the requested scope", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockImplementation(async (options: { scope: "user" | "org" }) =>
      options.scope === "user"
        ? credentials()
        : credentials({
            tokens: {
              access_token: "<ACCESS_TOKEN_EXAMPLE>",
              scope: BUILDER_OAUTH_SCOPES.join(" "),
              issuer: BUILDER_OAUTH_ISSUER,
            },
          }),
    );

    await expect(
      resolveBuilderOAuthRequestAccess({
        ownerEmail,
        requiredScope: "builder:assets:write",
      }),
    ).resolves.toMatchObject({ scope: "org", scopes: BUILDER_OAUTH_SCOPES });
  });

  it("reports the usable org grant when personal custody needs reconnect", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockImplementation(
      async (options: { scope: "user" | "org" }) =>
        options.scope === "user" ? null : "<ACCESS_TOKEN_EXAMPLE>",
    );
    readMock.mockResolvedValue(credentials());

    await expect(getBuilderOAuthConnectionScope(ownerEmail)).resolves.toBe(
      "org",
    );
  });

  it("reports stored custody for disconnect even when its token is unusable", async () => {
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-default" ? {} : null,
    );
    getAccessTokenMock.mockResolvedValue(null);

    await expect(getBuilderOAuthStoredScope(ownerEmail)).resolves.toBe("org");
    expect(getAccessTokenMock).not.toHaveBeenCalled();
  });

  // A stored credential with no `scope` claim predates both Builder always
  // setting one and this flow recording it, so it can only be an AI-only grant.
  // Crediting it with the upload scope would trade a clear local error for an
  // opaque 403 from Builder.
  it("keeps a scope-less legacy credential AI-only", async () => {
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(
      credentials({
        tokens: {
          access_token: "<ACCESS_TOKEN_EXAMPLE>",
          issuer: BUILDER_OAUTH_ISSUER,
        },
      }),
    );

    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toMatchObject({
      scopes: [BUILDER_OAUTH_SCOPE],
    });
    await expect(
      resolveBuilderOAuthRequestAccess({
        ownerEmail,
        requiredScope: "builder:assets:write",
      }),
    ).rejects.toThrow("does not grant builder:assets:write");
  });

  it("fails closed for a credential whose issuer or resource binding changed", async () => {
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(
      credentials({
        discoveryState: {
          authorizationServerUrl: "https://other.example.com",
          authorizationServerMetadata: {
            issuer: "https://other.example.com",
            authorization_endpoint: "https://other.example.com/oauth/authorize",
            token_endpoint: "https://other.example.com/oauth/token",
            registration_endpoint: "https://other.example.com/oauth/register",
            revocation_endpoint: "https://other.example.com/oauth/revoke",
          },
          resourceMetadata: {
            resource: BUILDER_OAUTH_RESOURCE,
            authorization_servers: ["https://other.example.com"],
          },
        },
      }),
    );
    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
  });

  it("delegates expiring bundles to the guarded generic OAuth refresher", async () => {
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-default" ? {} : null,
    );
    let stored = credentials({ tokenExpiresAt: Date.now() + 1_000 });
    readMock.mockImplementation(async () => stored);
    getAccessTokenMock.mockImplementation(async () => {
      stored = credentials({
        tokens: {
          ...stored.tokens,
          access_token: "<ROTATED_ACCESS_TOKEN_EXAMPLE>",
          refresh_token: "<ROTATED_REFRESH_TOKEN_EXAMPLE>",
        },
      });
      return "<ROTATED_ACCESS_TOKEN_EXAMPLE>";
    });

    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toMatchObject({
      accessToken: "<ROTATED_ACCESS_TOKEN_EXAMPLE>",
      scopes: [BUILDER_OAUTH_SCOPE],
    });
    expect(getAccessTokenMock).toHaveBeenCalledWith({
      key: perOrgKey(DEFAULT_ORG),
      scope: "org",
      scopeId: DEFAULT_ORG,
      serverUrl: BUILDER_OAUTH_RESOURCE,
    });
  });

  it("returns no session and does not double-mark when the resolver yields no token", async () => {
    // The credential lifecycle owns reconnect latching on a failed refresh, so
    // Builder just reports no session instead of writing its own flag.
    readMock.mockResolvedValue(
      credentials({ tokenExpiresAt: Date.now() + 1_000 }),
    );
    getAccessTokenMock.mockResolvedValue(null);

    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
    expect(markReconnectMock).not.toHaveBeenCalled();
  });

  it("revokes remotely on disconnect and always deletes local custody", async () => {
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-default" ? {} : null,
    );
    revokeMock.mockResolvedValue({
      local: "deleted",
      remote: "succeeded",
    });

    await expect(deleteBuilderOAuthSession(ownerEmail)).resolves.toEqual({
      localDeleted: true,
      remoteRevoked: true,
    });
    expect(revokeMock).toHaveBeenCalledWith({
      key: perOrgKey(DEFAULT_ORG),
      scope: "org",
      scopeId: DEFAULT_ORG,
      serverUrl: BUILDER_OAUTH_RESOURCE,
    });
  });

  it("deletes local custody even when Builder revocation fails", async () => {
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-default" ? {} : null,
    );
    revokeMock.mockResolvedValue({
      local: "deleted",
      remote: "failed",
    });

    await expect(deleteBuilderOAuthSession(ownerEmail)).resolves.toEqual({
      localDeleted: true,
      remoteRevoked: false,
    });
    expect(revokeMock).toHaveBeenCalledTimes(1);
  });
});

describe("Builder organization and personal connections", () => {
  // A tiny token store keyed like the real one, so a save, a read, and a
  // delete all see the same rows.
  function installTokenStore() {
    const rows = new Map<string, Record<string, unknown>>();
    const rowKey = (options: { scope: string; scopeId: string }) =>
      `${options.scope}:${options.scopeId}`;
    saveMock.mockImplementation(async (options) => {
      rows.set(rowKey(options), options.credentials);
    });
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        rows.has(owner) ? { stored: true } : null,
    );
    readMock.mockImplementation(async (options) => rows.get(rowKey(options)));
    getAccessTokenMock.mockImplementation(async (options) =>
      rows.has(rowKey(options)) ? `<ACCESS_TOKEN_${options.scope}>` : null,
    );
    revokeMock.mockImplementation(async (options) => {
      rows.delete(rowKey(options));
      return { local: "deleted", remote: "succeeded" };
    });
    return rows;
  }

  it("honors an explicit scope over the connector's role", async () => {
    installTokenStore();
    await expect(
      saveBuilderOAuthCredentials({
        ownerEmail,
        orgId: "org-acme",
        role: "member",
        scope: "org",
        credentials: credentials(),
      }),
    ).resolves.toBe("org");
    await expect(
      saveBuilderOAuthCredentials({
        ownerEmail,
        orgId: "org-acme",
        role: "owner",
        scope: "user",
        credentials: credentials(),
      }),
    ).resolves.toBe("user");
    expect(saveMock.mock.calls.map(([options]) => options.scope)).toEqual([
      "org",
      "user",
    ]);
  });

  it("refuses an explicit org write with no organization instead of saving it personally", async () => {
    resolveOrgMock.mockResolvedValue(null);
    await expect(
      saveBuilderOAuthCredentials({
        ownerEmail,
        role: "owner",
        scope: "org",
        credentials: credentials(),
      }),
    ).rejects.toThrow("An organization is required");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("uses a member's personal grant for them only and falls back to the org's once it is removed", async () => {
    installTokenStore();
    await saveBuilderOAuthCredentials({
      ownerEmail: "admin@example.com",
      orgId: DEFAULT_ORG,
      role: "admin",
      credentials: credentials(),
    });
    await saveBuilderOAuthCredentials({
      ownerEmail,
      orgId: DEFAULT_ORG,
      role: "member",
      scope: "user",
      credentials: credentials(),
    });

    await expect(
      getBuilderOAuthSession(ownerEmail, DEFAULT_ORG),
    ).resolves.toMatchObject({ scope: "user" });
    await expect(
      getBuilderOAuthSession("bob@example.com", DEFAULT_ORG),
    ).resolves.toMatchObject({ scope: "org" });

    await deleteBuilderOAuthSession(ownerEmail, "user", DEFAULT_ORG);

    await expect(
      getBuilderOAuthSession(ownerEmail, DEFAULT_ORG),
    ).resolves.toMatchObject({ scope: "org" });
    await expect(
      hasStoredBuilderOAuthGrant("admin@example.com", "org", DEFAULT_ORG),
    ).resolves.toBe(true);
  });

  it("reports both grants when both exist, each on its own", async () => {
    const rows = installTokenStore();
    rows.set(`org:${DEFAULT_ORG}`, { ...credentials(), connectedAt: 1_000 });
    rows.set(`user:${ownerEmail}`, {
      ...credentials(),
      connectedAt: 2_000,
      oauthLifecycle: { reconnectReason: "invalid_grant" },
    });

    await expect(
      getBuilderOAuthGrants(ownerEmail, DEFAULT_ORG),
    ).resolves.toEqual({
      org: { connectedAt: 1_000, needsReconnect: false },
      personal: { connectedAt: 2_000, needsReconnect: true, restricted: false },
    });
  });

  it("skips a restricted member's personal grant for the org's and keeps it stored", async () => {
    const rows = installTokenStore();
    rows.set(`org:${DEFAULT_ORG}`, { ...credentials(), connectedAt: 1_000 });
    rows.set(`user:${ownerEmail}`, { ...credentials(), connectedAt: 2_000 });
    isRestrictedMock.mockResolvedValue(true);

    await expect(
      getBuilderOAuthSession(ownerEmail, DEFAULT_ORG),
    ).resolves.toMatchObject({ scope: "org" });
    await expect(
      getBuilderOAuthGrants(ownerEmail, DEFAULT_ORG),
    ).resolves.toEqual({
      org: { connectedAt: 1_000, needsReconnect: false },
      personal: { connectedAt: 2_000, needsReconnect: false, restricted: true },
    });
    expect(isRestrictedMock).toHaveBeenCalledWith({
      email: ownerEmail,
      orgId: DEFAULT_ORG,
    });
    expect(rows.has(`user:${ownerEmail}`)).toBe(true);

    // Turning the restriction off restores the personal grant.
    isRestrictedMock.mockResolvedValue(false);
    await expect(
      getBuilderOAuthSession(ownerEmail, DEFAULT_ORG),
    ).resolves.toMatchObject({ scope: "user" });
  });

  it("reports a stored grant that no longer reads as Builder custody as needing reconnect", async () => {
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === `org:${DEFAULT_ORG}` ? { corrupt: true } : null,
    );
    readMock.mockResolvedValue(null);

    await expect(
      getBuilderOAuthGrants(ownerEmail, DEFAULT_ORG),
    ).resolves.toEqual({
      org: { connectedAt: null, needsReconnect: true },
    });
  });

  it("reports no grants as an empty record and skips the org lookup without an org", async () => {
    await expect(getBuilderOAuthGrants(ownerEmail, null)).resolves.toEqual({});
    expect(getRawTokensMock).toHaveBeenCalledTimes(1);
    expect(resolveOrgMock).not.toHaveBeenCalled();
  });

  it("lets owners and admins connect only the organization's connection", () => {
    expect(canRoleConnectPersonalBuilder("owner")).toBe(false);
    expect(canRoleConnectPersonalBuilder("admin")).toBe(false);
    expect(canRoleConnectPersonalBuilder("member")).toBe(true);
    expect(canRoleConnectPersonalBuilder(null)).toBe(true);
  });
});
