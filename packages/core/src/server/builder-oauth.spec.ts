import { beforeEach, describe, expect, it, vi } from "vitest";

const startMock = vi.hoisted(() => vi.fn());
const finishMock = vi.hoisted(() => vi.fn());
const readMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const revokeMock = vi.hoisted(() => vi.fn());
const getAccessTokenMock = vi.hoisted(() => vi.fn());
const validateIssuerMock = vi.hoisted(() => vi.fn());
const getRawTokensMock = vi.hoisted(() => vi.fn());
const mutateSettingMock = vi.hoisted(() => vi.fn());
const putSettingMock = vi.hoisted(() => vi.fn());
const getSettingMock = vi.hoisted(() => vi.fn());

vi.mock("../mcp-client/oauth-client.js", () => ({
  startMcpOAuthAuthorization: startMock,
  finishMcpOAuthAuthorization: finishMock,
  readMcpOAuthCredentials: readMock,
  saveMcpOAuthCredentials: saveMock,
  revokeMcpOAuthCredentials: revokeMock,
  getMcpOAuthAccessToken: getAccessTokenMock,
  validateMcpOAuthCallbackIssuer: validateIssuerMock,
}));

vi.mock("../oauth-tokens/store.js", () => ({
  getOAuthTokens: getRawTokensMock,
}));

vi.mock("../settings/store.js", () => ({
  mutateSetting: mutateSettingMock,
  putSetting: putSettingMock,
  getSetting: getSettingMock,
}));

import {
  BUILDER_OAUTH_AUTHORIZATION_ENDPOINT,
  BUILDER_OAUTH_AUTHORIZATION_METADATA,
  BUILDER_OAUTH_ISSUER,
  BUILDER_OAUTH_PROTECTED_RESOURCE_METADATA,
  BUILDER_OAUTH_REGISTRATION_ENDPOINT,
  BUILDER_OAUTH_RESOURCE,
  BUILDER_OAUTH_REVOCATION_ENDPOINT,
  BUILDER_OAUTH_SCOPE,
  BUILDER_OAUTH_SCOPES,
  BUILDER_OAUTH_TOKEN_ENDPOINT,
  deleteBuilderOAuthSession,
  finishBuilderOAuthAuthorization,
  getBuilderOAuthSession,
  hasBuilderOAuthSession,
  markBuilderOAuthReconnectRequired,
  resolveBuilderOAuthRequestAccess,
  startBuilderOAuthAuthorization,
} from "./builder-oauth.js";

const ownerEmail = "alice@example.com";

function credentials(overrides: Record<string, unknown> = {}) {
  return {
    serverUrl: BUILDER_OAUTH_RESOURCE,
    clientInformation: {
      client_id: "<CLIENT_ID_EXAMPLE>",
      issuer: BUILDER_OAUTH_ISSUER,
    },
    discoveryState: {
      authorizationServerUrl: BUILDER_OAUTH_ISSUER,
      resourceMetadataUrl: BUILDER_OAUTH_PROTECTED_RESOURCE_METADATA,
      authorizationServerMetadata: {
        issuer: BUILDER_OAUTH_ISSUER,
        authorization_endpoint: BUILDER_OAUTH_AUTHORIZATION_ENDPOINT,
        token_endpoint: BUILDER_OAUTH_TOKEN_ENDPOINT,
        registration_endpoint: BUILDER_OAUTH_REGISTRATION_ENDPOINT,
        revocation_endpoint: BUILDER_OAUTH_REVOCATION_ENDPOINT,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
      },
      resourceMetadata: {
        resource: BUILDER_OAUTH_RESOURCE,
        authorization_servers: [BUILDER_OAUTH_ISSUER],
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
  let lease: Record<string, unknown> | null = null;
  startMock.mockReset();
  finishMock.mockReset();
  readMock.mockReset();
  saveMock.mockReset();
  revokeMock.mockReset();
  getAccessTokenMock.mockReset();
  validateIssuerMock.mockReset();
  getRawTokensMock.mockReset();
  getSettingMock.mockReset();
  getSettingMock.mockResolvedValue(null);
  putSettingMock.mockReset();
  putSettingMock.mockResolvedValue(undefined);
  mutateSettingMock.mockReset();
  mutateSettingMock.mockImplementation(
    async (
      _key: string,
      updater: (
        current: Record<string, unknown> | null,
      ) => Record<string, unknown>,
    ) => {
      lease = updater(lease);
      return lease;
    },
  );
});

describe("Builder hosted user OAuth", () => {
  it("uses the exact fixed Builder contract and one least-privilege scope", () => {
    expect({
      issuer: BUILDER_OAUTH_ISSUER,
      resource: BUILDER_OAUTH_RESOURCE,
      protectedResourceMetadata: BUILDER_OAUTH_PROTECTED_RESOURCE_METADATA,
      authorizationMetadata: BUILDER_OAUTH_AUTHORIZATION_METADATA,
      authorization: BUILDER_OAUTH_AUTHORIZATION_ENDPOINT,
      token: BUILDER_OAUTH_TOKEN_ENDPOINT,
      registration: BUILDER_OAUTH_REGISTRATION_ENDPOINT,
      revoke: BUILDER_OAUTH_REVOCATION_ENDPOINT,
      scopes: BUILDER_OAUTH_SCOPES,
    }).toEqual({
      issuer: "https://mcp.builder.io",
      resource: "https://api.builder.io",
      protectedResourceMetadata:
        "https://mcp.builder.io/.well-known/oauth-protected-resource/api",
      authorizationMetadata:
        "https://mcp.builder.io/.well-known/oauth-authorization-server",
      authorization: "https://mcp.builder.io/oauth/authorize",
      token: "https://mcp.builder.io/oauth/token",
      registration: "https://mcp.builder.io/oauth/register",
      revoke: "https://mcp.builder.io/oauth/revoke",
      scopes: ["builder:ai:invoke"],
    });
    expect(BUILDER_OAUTH_SCOPES.join(" ")).not.toMatch(
      /offline_access|project|design|browser|agent|assets/,
    );
  });

  it("starts public PKCE authorization with Builder's fixed resource and scope", async () => {
    startMock.mockResolvedValue({
      authorizationUrl: new URL(BUILDER_OAUTH_AUTHORIZATION_ENDPOINT),
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
      authorizationUrl: BUILDER_OAUTH_AUTHORIZATION_ENDPOINT,
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
      discoveryState: {
        authorizationServerUrl: BUILDER_OAUTH_ISSUER,
        authorizationServerMetadata: {
          issuer: BUILDER_OAUTH_ISSUER,
          authorization_endpoint: BUILDER_OAUTH_AUTHORIZATION_ENDPOINT,
          token_endpoint: BUILDER_OAUTH_TOKEN_ENDPOINT,
          registration_endpoint: BUILDER_OAUTH_REGISTRATION_ENDPOINT,
          revocation_endpoint: BUILDER_OAUTH_REVOCATION_ENDPOINT,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
        },
        resourceMetadataUrl: BUILDER_OAUTH_PROTECTED_RESOURCE_METADATA,
        resourceMetadata: {
          resource: BUILDER_OAUTH_RESOURCE,
          authorization_servers: [BUILDER_OAUTH_ISSUER],
        },
      },
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
      key: "builder-general-resource-v1",
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
      "builder-general-resource-v1",
      "user:bob@example.com",
    );
  });

  it("does not return a stored access token after reconnect is required", async () => {
    getSettingMock.mockResolvedValue({ required: true, at: Date.now() });
    readMock.mockResolvedValue(credentials());

    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
    expect(readMock).not.toHaveBeenCalled();
  });

  it("marks reconnect required for a revoked OAuth grant", async () => {
    await markBuilderOAuthReconnectRequired(ownerEmail);
    expect(putSettingMock).toHaveBeenCalledWith(
      "builder-oauth-reconnect:user:alice@example.com",
      expect.objectContaining({ required: true }),
    );
  });

  it("treats malformed Builder-owned custody as present so callers fail closed", async () => {
    getRawTokensMock.mockResolvedValue({ corrupt: true });
    readMock.mockResolvedValue(null);
    await expect(hasBuilderOAuthSession(ownerEmail)).resolves.toBe(true);
    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
  });

  it("accepts custody whose serverUrl was canonicalized with a trailing slash", async () => {
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
      key: "builder-general-resource-v1",
      scope: "user",
      scopeId: ownerEmail,
      serverUrl: BUILDER_OAUTH_RESOURCE,
    });
  });

  it("allows one lease holder to refresh while waiters reload its persisted bundle", async () => {
    let stored = credentials({ tokenExpiresAt: Date.now() + 1_000 });
    let releaseRefresh!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    readMock.mockImplementation(async () => stored);
    getAccessTokenMock.mockImplementation(async () => {
      await refreshStarted;
      stored = credentials({
        tokens: {
          ...stored.tokens,
          access_token: "<ROTATED_ACCESS_TOKEN_EXAMPLE>",
          refresh_token: "<ROTATED_REFRESH_TOKEN_EXAMPLE>",
        },
      });
      return "<ROTATED_ACCESS_TOKEN_EXAMPLE>";
    });

    const first = getBuilderOAuthSession(ownerEmail);
    await vi.waitFor(() => expect(getAccessTokenMock).toHaveBeenCalledTimes(1));
    const second = getBuilderOAuthSession(ownerEmail);
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({
        accessToken: "<ROTATED_ACCESS_TOKEN_EXAMPLE>",
      }),
      expect.objectContaining({
        accessToken: "<ROTATED_ACCESS_TOKEN_EXAMPLE>",
      }),
    ]);
    expect(getAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it("marks reconnect and returns no token when refresh material is missing", async () => {
    readMock.mockResolvedValue(
      credentials({
        tokenExpiresAt: Date.now() + 1_000,
        tokens: {
          access_token: "<ACCESS_TOKEN_EXAMPLE>",
          scope: BUILDER_OAUTH_SCOPE,
          issuer: BUILDER_OAUTH_ISSUER,
        },
      }),
    );
    getAccessTokenMock.mockResolvedValue(null);

    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
    expect(putSettingMock).toHaveBeenCalledWith(
      "builder-oauth-reconnect:user:alice@example.com",
      expect.objectContaining({ required: true }),
    );
  });

  it("marks reconnect and returns no token when Builder rejects a refresh", async () => {
    readMock.mockResolvedValue(
      credentials({ tokenExpiresAt: Date.now() + 1_000 }),
    );
    getAccessTokenMock.mockResolvedValue(null);

    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
    expect(putSettingMock).toHaveBeenCalledWith(
      "builder-oauth-reconnect:user:alice@example.com",
      expect.objectContaining({ required: true }),
    );
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
      key: "builder-general-resource-v1",
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
