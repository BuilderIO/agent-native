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

import {
  BUILDER_OAUTH_ISSUER,
  BUILDER_OAUTH_RESOURCE,
  BUILDER_OAUTH_SCOPE,
  BUILDER_OAUTH_SCOPES,
  deleteBuilderOAuthSession,
  finishBuilderOAuthAuthorization,
  getBuilderOAuthSession,
  hasBuilderOAuthSession,
  markBuilderOAuthReconnectRequired,
  resolveBuilderOAuthRequestAccess,
  startBuilderOAuthAuthorization,
} from "./builder-oauth.js";

const ownerEmail = "alice@example.com";

const BASE_KEY = "builder-general-resource-v1";
function perUserKey(email: string): string {
  const digest = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
  return `${BASE_KEY}:u:${digest}`;
}
function perOrgKey(orgId: string): string {
  const digest = createHash("sha256").update(orgId).digest("hex");
  return `${BASE_KEY}:o:${digest}`;
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
  resolveOrgMock.mockReset();
  // Default to Personal context; org-scoped behavior is exercised explicitly.
  resolveOrgMock.mockResolvedValue(null);
});

describe("Builder hosted user OAuth", () => {
  it("uses the exact fixed Builder contract and one least-privilege scope", () => {
    expect({
      issuer: BUILDER_OAUTH_ISSUER,
      resource: BUILDER_OAUTH_RESOURCE,
      scopes: BUILDER_OAUTH_SCOPES,
    }).toEqual({
      issuer: "https://mcp.builder.io",
      resource: "https://api.builder.io",
      scopes: ["builder:ai:invoke"],
    });
    expect(BUILDER_OAUTH_SCOPES.join(" ")).not.toMatch(
      /offline_access|project|design|browser|agent|assets/,
    );
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
      scope: BUILDER_OAUTH_SCOPE,
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
      credentials: finished,
    });
    expect(validateIssuerMock).toHaveBeenCalledWith(
      finished.discoveryState,
      BUILDER_OAUTH_ISSUER,
    );
    expect(finishMock).toHaveBeenCalledWith(
      expect.objectContaining({ iss: BUILDER_OAUTH_ISSUER }),
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

  it("keeps users isolated in every token-store operation", async () => {
    getRawTokensMock.mockResolvedValue(null);
    await hasBuilderOAuthSession("Bob@Example.com");
    expect(getRawTokensMock).toHaveBeenCalledWith(
      "mcp",
      perUserKey("bob@example.com"),
      "user:bob@example.com",
    );
  });

  it("shares one org-scoped credential across members of the same org", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
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
      credentials: finished,
    });
  });

  it("reports the requesting user's email even when the token is org-scoped", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
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
    await markBuilderOAuthReconnectRequired(ownerEmail);
    expect(markReconnectMock).toHaveBeenCalledWith({
      key: perUserKey(ownerEmail),
      scope: "user",
      scopeId: ownerEmail,
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

  it("fails closed for a credential whose issuer or resource binding changed", async () => {
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
      key: perUserKey(ownerEmail),
      scope: "user",
      scopeId: ownerEmail,
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
    revokeMock.mockResolvedValue({
      local: "deleted",
      remote: "succeeded",
    });

    await expect(deleteBuilderOAuthSession(ownerEmail)).resolves.toEqual({
      localDeleted: true,
      remoteRevoked: true,
    });
    expect(revokeMock).toHaveBeenCalledWith({
      key: perUserKey(ownerEmail),
      scope: "user",
      scopeId: ownerEmail,
      serverUrl: BUILDER_OAUTH_RESOURCE,
    });
  });

  it("deletes local custody even when Builder revocation fails", async () => {
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
