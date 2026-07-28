import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const refreshAuthorizationMock = vi.hoisted(() => vi.fn());
const validateAuthorizationResponseIssuerMock = vi.hoisted(() => vi.fn());
const deleteOAuthTokensMock = vi.hoisted(() => vi.fn());
const getOAuthTokensMock = vi.hoisted(() => vi.fn());
const saveOAuthTokensMock = vi.hoisted(() => vi.fn());

vi.mock("@modelcontextprotocol/client", () => ({
  auth: authMock,
  refreshAuthorization: refreshAuthorizationMock,
  validateAuthorizationResponseIssuer: validateAuthorizationResponseIssuerMock,
}));

vi.mock("../oauth-tokens/store.js", () => ({
  deleteOAuthTokens: deleteOAuthTokensMock,
  getOAuthTokens: getOAuthTokensMock,
  saveOAuthTokens: saveOAuthTokensMock,
}));

import {
  deleteMcpOAuthCredentials,
  finishMcpOAuthAuthorization,
  getMcpOAuthAccessToken,
  McpOAuthClientProvider,
  readMcpOAuthCredentials,
  saveMcpOAuthCredentials,
  startMcpOAuthAuthorization,
  tokenExpiresAt,
  validateMcpOAuthCallbackIssuer,
} from "./oauth-client.js";

const clientInformation = {
  client_id: "mcp-client-test",
  redirect_uris: ["https://app.example.com/callback"],
  issuer: "https://auth.example.com",
};

const credentials = {
  serverUrl: "https://mcp.example.com/mcp",
  clientInformation,
  discoveryState: {
    authorizationServerUrl: "https://auth.example.com",
    authorizationServerMetadata: {
      issuer: "https://auth.example.com",
      authorization_endpoint: "https://auth.example.com/authorize",
      token_endpoint: "https://auth.example.com/token",
      response_types_supported: ["code"],
      authorization_response_iss_parameter_supported: true,
    },
  },
  tokens: {
    access_token: "<ACCESS_TOKEN>",
    refresh_token: "<REFRESH_TOKEN>",
    token_type: "bearer",
    issuer: "https://auth.example.com",
  },
  tokenExpiresAt: Date.now() + 3_600_000,
};

beforeEach(() => {
  authMock.mockReset();
  refreshAuthorizationMock.mockReset();
  deleteOAuthTokensMock.mockReset();
  getOAuthTokensMock.mockReset();
  saveOAuthTokensMock.mockReset();
  validateAuthorizationResponseIssuerMock.mockReset();
});

describe("MCP OAuth client", () => {
  it("starts a standard MCP authorization flow and preserves PKCE state", async () => {
    authMock.mockImplementationOnce(
      async (provider: McpOAuthClientProvider) => {
        provider.saveClientInformation(clientInformation as any);
        provider.saveCodeVerifier("<CODE_VERIFIER>");
        provider.redirectToAuthorization(
          new URL("https://auth.example.com/authorize?state=<STATE>"),
        );
        return "REDIRECT";
      },
    );

    const result = await startMcpOAuthAuthorization({
      serverUrl: "https://mcp.example.com/mcp",
      redirectUrl: "https://app.example.com/callback",
      state: "<STATE>",
    });

    expect(result.authorizationUrl.href).toContain(
      "https://auth.example.com/authorize",
    );
    expect(result.codeVerifier).toBe("<CODE_VERIFIER>");
    expect(result.clientInformation).toEqual(clientInformation);
    expect(
      new McpOAuthClientProvider({
        serverUrl: "https://mcp.example.com/mcp",
        redirectUrl: "https://app.example.com/callback",
        state: "<STATE>",
      }).clientMetadata,
    ).toMatchObject({
      application_type: "web",
      grant_types: ["authorization_code", "refresh_token"],
    });
  });

  it("derives native application_type for loopback callbacks", () => {
    const provider = new McpOAuthClientProvider({
      serverUrl: "https://mcp.example.com/mcp",
      redirectUrl: "http://localhost:54545/callback",
      state: "<STATE>",
    });

    expect(provider.clientMetadata.application_type).toBe("native");
  });

  it("guards SDK OAuth requests and persisted discovery URLs", async () => {
    let fetchFn:
      | ((url: string | URL, init?: RequestInit) => Promise<Response>)
      | undefined;
    authMock.mockImplementationOnce(
      async (
        provider: McpOAuthClientProvider,
        options: { fetchFn?: typeof fetchFn },
      ) => {
        fetchFn = options.fetchFn;
        provider.saveClientInformation(clientInformation as any);
        provider.saveCodeVerifier("<CODE_VERIFIER>");
        provider.redirectToAuthorization(
          new URL("https://auth.example.com/authorize"),
        );
        return "REDIRECT";
      },
    );

    await startMcpOAuthAuthorization({
      serverUrl: "https://mcp.example.com/mcp",
      redirectUrl: "https://app.example.com/callback",
      state: "<STATE>",
    });

    await expect(
      fetchFn!("https://127.0.0.1/.well-known/oauth-authorization-server"),
    ).rejects.toThrow(/private\/internal address/);
    const provider = new McpOAuthClientProvider({
      serverUrl: "https://mcp.example.com/mcp",
      redirectUrl: "https://app.example.com/callback",
      state: "<STATE>",
    });
    expect(() =>
      provider.saveDiscoveryState({
        authorizationServerUrl: "https://10.0.0.5/oauth",
      }),
    ).toThrow(/private\/internal address/);
  });

  it("validates every OAuth redirect hop and strips credentials across origins", async () => {
    let fetchFn:
      | ((url: string | URL, init?: RequestInit) => Promise<Response>)
      | undefined;
    authMock.mockImplementationOnce(
      async (
        _provider: McpOAuthClientProvider,
        options: { fetchFn?: typeof fetchFn },
      ) => {
        fetchFn = options.fetchFn;
        _provider.saveClientInformation(clientInformation as any);
        _provider.saveCodeVerifier("<CODE_VERIFIER>");
        _provider.redirectToAuthorization(
          new URL("https://auth.example.com/authorize"),
        );
        return "REDIRECT";
      },
    );
    await startMcpOAuthAuthorization({
      serverUrl: "https://mcp.example.com/mcp",
      redirectUrl: "https://app.example.com/callback",
      state: "<STATE>",
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/private" },
      }),
    );
    await expect(
      fetchFn!("https://auth.example.com/discovery", {
        headers: { Authorization: "Bearer <TOKEN>" },
      }),
    ).rejects.toThrow(/redirect target|private\/internal address/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://other.example.com/token" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await expect(
      fetchFn!("https://auth.example.com/discovery", {
        method: "POST",
        headers: { Authorization: "Bearer <TOKEN>" },
        body: "code=<CODE>",
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://other.example.com/token",
    );
    const redirectedInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(redirectedInit.method).toBe("GET");
    expect(new Headers(redirectedInit.headers).has("authorization")).toBe(
      false,
    );
  });

  it("finishes the code exchange without exposing the token to the flow result", async () => {
    authMock.mockImplementationOnce(
      async (provider: McpOAuthClientProvider, options: any) => {
        provider.saveClientInformation(clientInformation as any);
        provider.saveTokens({
          access_token: "<ACCESS_TOKEN>",
          refresh_token: "<REFRESH_TOKEN>",
          token_type: "bearer",
          issuer: "https://auth.example.com",
        });
        expect(options.iss).toBe("https://auth.example.com");
        return "AUTHORIZED";
      },
    );

    const result = await finishMcpOAuthAuthorization({
      serverUrl: "https://mcp.example.com/mcp",
      redirectUrl: "https://app.example.com/callback",
      state: "<STATE>",
      codeVerifier: "<CODE_VERIFIER>",
      clientInformation: clientInformation as any,
      authorizationCode: "<AUTHORIZATION_CODE>",
      iss: "https://auth.example.com",
    });

    expect(result.credentials.serverUrl).toBe("https://mcp.example.com/mcp");
    expect(result.credentials.tokens.access_token).toBe("<ACCESS_TOKEN>");
    expect(result.credentials.clientInformation).toEqual(clientInformation);
  });

  it("binds provider credentials to their authorization-server issuer", () => {
    const provider = new McpOAuthClientProvider({
      serverUrl: "https://mcp.example.com/mcp",
      redirectUrl: "https://app.example.com/callback",
      state: "<STATE>",
    });
    provider.saveClientInformation(
      {
        client_id: "mcp-client-test",
      },
      { issuer: "https://auth.example.com" },
    );
    provider.saveTokens(
      {
        access_token: "<ACCESS_TOKEN>",
        token_type: "bearer",
      },
      { issuer: "https://auth.example.com" },
    );

    expect(
      provider.clientInformation({ issuer: "https://auth.example.com" }),
    ).toMatchObject({ issuer: "https://auth.example.com" });
    expect(
      provider.clientInformation({ issuer: "https://other.example.com" }),
    ).toBeUndefined();
    expect(provider.tokens({ issuer: "https://other.example.com" })).toBe(
      undefined,
    );
  });

  it("validates callback iss against the recorded authorization server", () => {
    validateMcpOAuthCallbackIssuer(
      credentials.discoveryState as any,
      "https://auth.example.com",
    );

    expect(validateAuthorizationResponseIssuerMock).toHaveBeenCalledWith({
      iss: "https://auth.example.com",
      expectedIssuer: "https://auth.example.com",
      issParameterSupported: true,
    });
  });

  it("stores the credential bundle in the encrypted OAuth-token store", async () => {
    await saveMcpOAuthCredentials({
      key: "mcp_oauth:test",
      scope: "user",
      scopeId: "alice@example.com",
      credentials: credentials as any,
    });

    expect(saveOAuthTokensMock).toHaveBeenCalledWith(
      "mcp",
      "mcp_oauth:test",
      credentials,
      "user:alice@example.com",
    );
  });

  it("refreshes an expiring token and persists the replacement bundle", async () => {
    const expiring = {
      ...credentials,
      tokenExpiresAt: Date.now() - 1,
    };
    getOAuthTokensMock.mockResolvedValueOnce(expiring);
    refreshAuthorizationMock.mockResolvedValueOnce({
      access_token: "<NEW_ACCESS_TOKEN>",
      token_type: "bearer",
      expires_in: 3600,
    });

    await expect(
      getMcpOAuthAccessToken({
        key: "mcp_oauth:test",
        scope: "org",
        scopeId: "org-test",
        serverUrl: "https://mcp.example.com/mcp",
      }),
    ).resolves.toBe("<NEW_ACCESS_TOKEN>");

    expect(saveOAuthTokensMock).toHaveBeenCalledTimes(1);
    expect(saveOAuthTokensMock.mock.calls[0]?.[0]).toBe("mcp");
    expect(saveOAuthTokensMock.mock.calls[0]?.[1]).toBe("mcp_oauth:test");
    expect(saveOAuthTokensMock.mock.calls[0]?.[3]).toBe("org:org-test");
    expect(
      (saveOAuthTokensMock.mock.calls[0]?.[2] as any).tokens.refresh_token,
    ).toBe("<REFRESH_TOKEN>");
    expect((saveOAuthTokensMock.mock.calls[0]?.[2] as any).tokens.issuer).toBe(
      "https://auth.example.com",
    );
  });

  it("requires reauthorization for expiring legacy credentials without issuer binding", async () => {
    getOAuthTokensMock.mockResolvedValueOnce({
      ...credentials,
      clientInformation: {
        client_id: "legacy-client",
      },
      tokenExpiresAt: Date.now() - 1,
    });

    await expect(
      getMcpOAuthAccessToken({
        key: "mcp_oauth:test",
        scope: "user",
        scopeId: "alice@example.com",
        serverUrl: "https://mcp.example.com/mcp",
      }),
    ).resolves.toBeNull();
    expect(refreshAuthorizationMock).not.toHaveBeenCalled();
  });

  it("does not return an expired token when refresh fails", async () => {
    getOAuthTokensMock.mockResolvedValueOnce({
      ...credentials,
      tokenExpiresAt: Date.now() - 1,
    });
    refreshAuthorizationMock.mockRejectedValueOnce(
      new Error("authorization server unavailable"),
    );

    await expect(
      getMcpOAuthAccessToken({
        key: "mcp_oauth:test",
        scope: "user",
        scopeId: "alice@example.com",
        serverUrl: "https://mcp.example.com/mcp",
      }),
    ).resolves.toBeNull();
  });

  it("keeps a still-valid token when an early refresh fails", async () => {
    getOAuthTokensMock.mockResolvedValueOnce({
      ...credentials,
      tokenExpiresAt: Date.now() + 30_000,
    });
    refreshAuthorizationMock.mockRejectedValueOnce(
      new Error("authorization server unavailable"),
    );

    await expect(
      getMcpOAuthAccessToken({
        key: "mcp_oauth:test",
        scope: "user",
        scopeId: "alice@example.com",
        serverUrl: "https://mcp.example.com/mcp",
      }),
    ).resolves.toBe("<ACCESS_TOKEN>");
  });

  it("rejects malformed stored bundles", async () => {
    getOAuthTokensMock.mockResolvedValueOnce({ access_token: "<TOKEN>" });

    await expect(
      readMcpOAuthCredentials({
        key: "mcp_oauth:test",
        scope: "user",
        scopeId: "alice@example.com",
      }),
    ).resolves.toBeNull();
  });

  it("binds reads and deletes to the credential owner", async () => {
    getOAuthTokensMock.mockResolvedValueOnce(null);
    deleteOAuthTokensMock.mockResolvedValueOnce(1);

    await readMcpOAuthCredentials({
      key: "mcp_oauth:test",
      scope: "org",
      scopeId: "org-test",
    });
    await deleteMcpOAuthCredentials({
      key: "mcp_oauth:test",
      scope: "org",
      scopeId: "org-test",
    });

    expect(getOAuthTokensMock).toHaveBeenCalledWith(
      "mcp",
      "mcp_oauth:test",
      "org:org-test",
    );
    expect(deleteOAuthTokensMock).toHaveBeenCalledWith(
      "mcp",
      "mcp_oauth:test",
      "org:org-test",
    );
  });

  it("computes an expiry only for positive finite expires_in values", () => {
    const expiresAt = tokenExpiresAt({ expires_in: 60 } as any);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(tokenExpiresAt({ expires_in: 0 } as any)).toBeUndefined();
    expect(
      tokenExpiresAt({ expires_in: "not-a-duration" } as any),
    ).toBeUndefined();
  });
});
