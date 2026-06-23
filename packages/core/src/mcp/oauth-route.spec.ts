import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("h3", () => ({
  getMethod: (event: any) => event.method ?? "GET",
  getHeader: (event: any, name: string) =>
    event.headers?.[name.toLowerCase()] ?? event.headers?.[name],
  getQuery: (event: any) => event.query ?? {},
  setResponseStatus: (event: any, status: number) => {
    event.status = status;
  },
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: vi.fn(async (event: any) => event.body ?? {}),
}));

const getSessionMock = vi.fn();
const getConfiguredLoginHtmlMock = vi.fn(() => "<form>Sign in</form>");
vi.mock("../server/auth.js", () => ({
  getSession: (...a: any[]) => getSessionMock(...a),
  getConfiguredLoginHtml: (...a: any[]) => getConfiguredLoginHtmlMock(...a),
}));

const getOrgDomainMock = vi.fn(async () => "builder.io");
vi.mock("../org/context.js", () => ({
  getOrgDomain: (...args: any[]) => getOrgDomainMock(...args),
}));

const clients = new Map<string, any>();
const codes = new Map<string, any>();
const refreshRows = new Map<string, any>();
let counter = 0;

vi.mock("./oauth-store.js", () => ({
  MCP_OAUTH_ACCESS_TOKEN_TTL: "30d",
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: 30 * 86400,
  MCP_OAUTH_CODE_TTL_MS: 600_000,
  MCP_OAUTH_REFRESH_TOKEN_TTL_MS: 365 * 24 * 60 * 60_000,
  generateOpaqueToken: vi.fn(() => `opaque-${++counter}`),
  registerOAuthClient: vi.fn(async (params: any) => {
    const row = {
      clientId: `client-${++counter}`,
      clientName: params.clientName ?? null,
      redirectUris: params.redirectUris,
      grantTypes: params.grantTypes ?? ["authorization_code", "refresh_token"],
      responseTypes: params.responseTypes ?? ["code"],
      tokenEndpointAuthMethod: params.tokenEndpointAuthMethod ?? "none",
      createdAt: 1_700_000_000_000,
    };
    clients.set(row.clientId, row);
    return row;
  }),
  getOAuthClient: vi.fn(
    async (clientId: string) => clients.get(clientId) ?? null,
  ),
  createOAuthCode: vi.fn(async (params: any) => {
    const row = {
      code: `code-${++counter}`,
      ...params,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
      consumedAt: null,
    };
    codes.set(row.code, row);
    return row;
  }),
  getOAuthCode: vi.fn(async (code: string) => {
    const row = codes.get(code);
    if (!row || row.consumedAt || row.expiresAt < Date.now()) return null;
    return row;
  }),
  consumeOAuthCode: vi.fn(async (code: string) => {
    const row = codes.get(code);
    if (!row || row.consumedAt) return null;
    row.consumedAt = Date.now();
    return row;
  }),
  createOAuthRefreshToken: vi.fn(async (params: any) => {
    refreshRows.set(params.refreshToken, {
      id: `refresh-${++counter}`,
      tokenHash: params.refreshToken,
      ...params,
      createdAt: Date.now(),
      expiresAt: Date.now() + 90 * 24 * 60 * 60_000,
      revokedAt: null,
    });
  }),
  getOAuthRefreshToken: vi.fn(async (refreshToken: string) => {
    const row = refreshRows.get(refreshToken);
    if (!row || row.revokedAt) return null;
    return row;
  }),
  touchOAuthRefreshToken: vi.fn(async (refreshToken: string) => {
    const row = refreshRows.get(refreshToken);
    if (row && !row.revokedAt) {
      const now = Date.now();
      row.lastUsedAt = now;
      row.expiresAt = now + 365 * 24 * 60 * 60_000;
    }
  }),
  rotateOAuthRefreshToken: vi.fn(
    async ({ oldRefreshToken, newRefreshToken }) => {
      const old = refreshRows.get(oldRefreshToken);
      if (!old || old.revokedAt) return null;
      old.revokedAt = Date.now();
      const next = { ...old, tokenHash: newRefreshToken, revokedAt: null };
      refreshRows.set(newRefreshToken, next);
      return next;
    },
  ),
}));

const {
  handleMcpOAuth,
  handleMcpOAuthAuthorizationServerMetadata,
  handleMcpOAuthProtectedResourceMetadata,
} = await import("./oauth-route.js");
const { verifyMcpOAuthAccessToken } = await import("./oauth-token.js");

function event(
  opts: {
    method?: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: Record<string, string> | string;
  } = {},
) {
  return {
    method: opts.method ?? "GET",
    headers: {
      host: "mail.agent-native.com",
      "x-forwarded-proto": "https",
      ...(opts.headers ?? {}),
    },
    query: opts.query ?? {},
    body: opts.body ?? {},
    url: { pathname: "" },
  } as any;
}

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("MCP OAuth route", () => {
  beforeEach(() => {
    clients.clear();
    codes.clear();
    refreshRows.clear();
    counter = 0;
    vi.clearAllMocks();
    process.env.A2A_SECRET = "test-oauth-secret";
    delete process.env.APP_BASE_PATH;
    delete process.env.APP_URL;
    delete process.env.VITE_APP_URL;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.VITE_BETTER_AUTH_URL;
    delete process.env.WORKSPACE_OAUTH_ORIGIN;
    delete process.env.VITE_WORKSPACE_OAUTH_ORIGIN;
    getSessionMock.mockResolvedValue({
      email: "steve@example.com",
      orgId: "org_123",
    });
  });

  it("serves protected-resource and authorization-server metadata", async () => {
    const protectedRes = handleMcpOAuthProtectedResourceMetadata(event());
    expect(protectedRes.status).toBe(200);
    await expect(protectedRes.json()).resolves.toMatchObject({
      resource: "https://mail.agent-native.com/_agent-native/mcp",
      authorization_servers: ["https://mail.agent-native.com"],
      scopes_supported: ["mcp:read", "mcp:write", "mcp:apps"],
    });

    const authRes = handleMcpOAuthAuthorizationServerMetadata(event());
    await expect(authRes.json()).resolves.toMatchObject({
      issuer: "https://mail.agent-native.com",
      authorization_endpoint:
        "https://mail.agent-native.com/_agent-native/mcp/oauth/authorize",
      token_endpoint:
        "https://mail.agent-native.com/_agent-native/mcp/oauth/token",
      registration_endpoint:
        "https://mail.agent-native.com/_agent-native/mcp/oauth/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("prefers configured public URL over forwarded request headers for OAuth resource", async () => {
    process.env.APP_URL = "https://plan.agent-native.com";
    const protectedRes = handleMcpOAuthProtectedResourceMetadata(
      event({
        headers: {
          host: "internal.netlify.local",
          "x-forwarded-host": "preview-random.netlify.app",
          "x-forwarded-proto": "http",
        },
      }),
    );
    await expect(protectedRes.json()).resolves.toMatchObject({
      resource: "https://plan.agent-native.com/_agent-native/mcp",
      authorization_servers: ["https://plan.agent-native.com"],
    });

    const authRes = handleMcpOAuthAuthorizationServerMetadata(
      event({
        headers: {
          host: "internal.netlify.local",
          "x-forwarded-host": "preview-random.netlify.app",
          "x-forwarded-proto": "http",
        },
      }),
    );
    await expect(authRes.json()).resolves.toMatchObject({
      issuer: "https://plan.agent-native.com",
      token_endpoint:
        "https://plan.agent-native.com/_agent-native/mcp/oauth/token",
    });
  });

  it("registers public OAuth clients with safe redirect URIs", async () => {
    const res = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          client_name: "Claude Code",
          redirect_uris: ["http://localhost:54545/callback"],
          token_endpoint_auth_method: "none",
        } as any,
      }),
      "/register",
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      client_name: "Claude Code",
      redirect_uris: ["http://localhost:54545/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("allows IPv6 loopback redirect URIs during registration", async () => {
    const res = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          client_name: "IPv6 local client",
          redirect_uris: ["http://[::1]:54545/callback"],
          token_endpoint_auth_method: "none",
        } as any,
      }),
      "/register",
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      redirect_uris: ["http://[::1]:54545/callback"],
    });
  });

  it("allows private-use IDE scheme redirect URIs during registration", async () => {
    const res = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          client_name: "Cursor",
          redirect_uris: [
            "cursor://anysphere.cursor-retrieval/mcp/oauth/callback",
          ],
          token_endpoint_auth_method: "none",
        } as any,
      }),
      "/register",
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      redirect_uris: ["cursor://anysphere.cursor-retrieval/mcp/oauth/callback"],
    });
  });

  it("rejects script- and file-capable redirect schemes during registration", async () => {
    for (const uri of [
      "javascript:alert(1)",
      "data:text/html,evil",
      "file:///etc/passwd",
      "http://evil.example.com/callback",
    ]) {
      const res = await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            client_name: "Bad client",
            redirect_uris: [uri],
            token_endpoint_auth_method: "none",
          } as any,
        }),
        "/register",
      );
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: "invalid_client_metadata",
      });
    }
  });

  it("serves login HTML when authorize is opened without a browser session", async () => {
    const client = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            redirect_uris: ["http://localhost:5555/callback"],
          } as any,
        }),
        "/register",
      )
    ).json();
    getSessionMock.mockResolvedValueOnce(null);
    const res = await handleMcpOAuth(
      event({
        query: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge("v".repeat(50)),
          code_challenge_method: "S256",
        },
      }),
      "/authorize",
      { appName: "Mail" },
    );
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain("Sign in");
  });

  it("approves an authorization code and exchanges it for scoped MCP tokens", async () => {
    const client = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            redirect_uris: ["http://localhost:5555/callback"],
          } as any,
        }),
        "/register",
      )
    ).json();
    const verifier = "v".repeat(50);
    const consent = await handleMcpOAuth(
      event({
        query: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          scope: "mcp:read mcp:apps",
          state: "state-123",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
        },
      }),
      "/authorize",
      { appName: "Mail" },
    );
    const consentHtml = await consent.text();
    const consentToken =
      consentHtml.match(/name="consent_token" value="([^"]+)"/)?.[1] ?? "";
    expect(consentToken).not.toBe("");
    const authorize = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          decision: "approve",
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          scope: "mcp:read mcp:apps",
          state: "state-123",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
          consent_token: consentToken,
        },
      }),
      "/authorize",
      { appName: "Mail" },
    );
    expect(authorize.status).toBe(302);
    const location = authorize.headers.get("location")!;
    const code = new URL(location).searchParams.get("code")!;
    expect(location).toContain("state=state-123");

    const token = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "authorization_code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          code,
          code_verifier: verifier,
        },
      }),
      "/token",
    );
    expect(token.status).toBe(200);
    const body = await token.json();
    expect(body).toMatchObject({
      token_type: "Bearer",
      expires_in: 30 * 86400,
      scope: "mcp:read mcp:apps",
    });
    expect(body.refresh_token).toBeTruthy();
    await expect(
      verifyMcpOAuthAccessToken(
        body.access_token,
        "https://mail.agent-native.com/_agent-native/mcp",
      ),
    ).resolves.toMatchObject({
      userEmail: "steve@example.com",
      orgId: "org_123",
      orgDomain: "builder.io",
      scopes: ["mcp:read", "mcp:apps"],
      clientId: client.client_id,
    });
  });

  it("preserves org_id in OAuth access tokens even when the org has no domain", async () => {
    getOrgDomainMock.mockResolvedValueOnce(undefined);
    const client = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            redirect_uris: ["http://localhost:5555/callback"],
          } as any,
        }),
        "/register",
      )
    ).json();
    const verifier = "v".repeat(50);
    const consent = await handleMcpOAuth(
      event({
        query: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
        },
      }),
      "/authorize",
    );
    const consentToken =
      (await consent.text()).match(
        /name="consent_token" value="([^"]+)"/,
      )?.[1] ?? "";
    const authorize = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          decision: "approve",
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
          consent_token: consentToken,
        },
      }),
      "/authorize",
    );
    const code = new URL(authorize.headers.get("location")!).searchParams.get(
      "code",
    )!;

    const token = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "authorization_code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          code,
          code_verifier: verifier,
        },
      }),
      "/token",
    );
    const body = await token.json();

    await expect(
      verifyMcpOAuthAccessToken(
        body.access_token,
        "https://mail.agent-native.com/_agent-native/mcp",
      ),
    ).resolves.toMatchObject({
      userEmail: "steve@example.com",
      orgId: "org_123",
      orgDomain: undefined,
      clientId: client.client_id,
    });
  });

  it("rejects invalid-only scope requests", async () => {
    const client = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            redirect_uris: ["http://localhost:5555/callback"],
          } as any,
        }),
        "/register",
      )
    ).json();
    const res = await handleMcpOAuth(
      event({
        query: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          scope: "mcp:typo",
          code_challenge: challenge("v".repeat(50)),
          code_challenge_method: "S256",
        },
      }),
      "/authorize",
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("invalid_scope");
    expect(location.searchParams.get("code")).toBeNull();
  });

  it("accepts authorize POST origins for base-path deployments", async () => {
    process.env.APP_BASE_PATH = "/dispatch";
    const client = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            redirect_uris: ["http://localhost:5555/callback"],
          } as any,
        }),
        "/register",
      )
    ).json();
    const verifier = "v".repeat(50);
    const resource = "https://mail.agent-native.com/dispatch/_agent-native/mcp";
    const consent = await handleMcpOAuth(
      event({
        query: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource,
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
        },
      }),
      "/authorize",
    );
    const consentToken =
      (await consent.text()).match(
        /name="consent_token" value="([^"]+)"/,
      )?.[1] ?? "";
    expect(consentToken).not.toBe("");

    const authorize = await handleMcpOAuth(
      event({
        method: "POST",
        headers: { origin: "https://mail.agent-native.com" },
        body: {
          decision: "approve",
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource,
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
          consent_token: consentToken,
        },
      }),
      "/authorize",
    );
    expect(authorize.status).toBe(302);
    expect(
      new URL(authorize.headers.get("location")!).searchParams.get("code"),
    ).toBeTruthy();
  });

  it("reuses refresh tokens so parallel chats do not invalidate each other", async () => {
    const client = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            redirect_uris: ["http://localhost:5555/callback"],
          } as any,
        }),
        "/register",
      )
    ).json();
    const verifier = "v".repeat(50);
    const consent = await handleMcpOAuth(
      event({
        query: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
        },
      }),
      "/authorize",
    );
    const consentToken =
      (await consent.text()).match(
        /name="consent_token" value="([^"]+)"/,
      )?.[1] ?? "";
    expect(consentToken).not.toBe("");
    const authorize = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          decision: "approve",
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
          consent_token: consentToken,
        },
      }),
      "/authorize",
    );
    const code = new URL(authorize.headers.get("location")!).searchParams.get(
      "code",
    )!;
    const first = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            grant_type: "authorization_code",
            client_id: client.client_id,
            redirect_uri: "http://localhost:5555/callback",
            code,
            code_verifier: verifier,
          },
        }),
        "/token",
      )
    ).json();
    const second = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "refresh_token",
          client_id: client.client_id,
          refresh_token: first.refresh_token,
        },
      }),
      "/token",
    );
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.refresh_token).toBe(first.refresh_token);
    await expect(
      verifyMcpOAuthAccessToken(
        body.access_token,
        "https://mail.agent-native.com/_agent-native/mcp",
      ),
    ).resolves.toMatchObject({
      userEmail: "steve@example.com",
      orgId: "org_123",
      orgDomain: "builder.io",
      clientId: client.client_id,
    });
    expect(refreshRows.get(first.refresh_token)?.revokedAt).toBeFalsy();
    expect(refreshRows.get(first.refresh_token)?.lastUsedAt).toBeTruthy();

    const parallel = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "refresh_token",
          client_id: client.client_id,
          refresh_token: first.refresh_token,
        },
      }),
      "/token",
    );
    expect(parallel.status).toBe(200);
    const parallelBody = await parallel.json();
    expect(parallelBody.refresh_token).toBe(first.refresh_token);
  });

  it("does not consume an authorization code when client_id mismatches", async () => {
    const client = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            redirect_uris: ["http://localhost:5555/callback"],
          } as any,
        }),
        "/register",
      )
    ).json();
    const verifier = "v".repeat(50);
    const consent = await handleMcpOAuth(
      event({
        query: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
        },
      }),
      "/authorize",
    );
    const consentToken =
      (await consent.text()).match(
        /name="consent_token" value="([^"]+)"/,
      )?.[1] ?? "";
    const authorize = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          decision: "approve",
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
          consent_token: consentToken,
        },
      }),
      "/authorize",
    );
    const code = new URL(authorize.headers.get("location")!).searchParams.get(
      "code",
    )!;

    const mismatch = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "authorization_code",
          client_id: "other-client",
          redirect_uri: "http://localhost:5555/callback",
          code,
          code_verifier: verifier,
        },
      }),
      "/token",
    );
    expect(mismatch.status).toBe(400);
    expect(codes.get(code)?.consumedAt).toBeFalsy();

    const retry = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "authorization_code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          code,
          code_verifier: verifier,
        },
      }),
      "/token",
    );
    expect(retry.status).toBe(200);
    expect(codes.get(code)?.consumedAt).toBeTruthy();
  });

  it("does not revoke a refresh token when client_id mismatches", async () => {
    const client = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            redirect_uris: ["http://localhost:5555/callback"],
          } as any,
        }),
        "/register",
      )
    ).json();
    const verifier = "v".repeat(50);
    const consent = await handleMcpOAuth(
      event({
        query: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
        },
      }),
      "/authorize",
    );
    const consentToken =
      (await consent.text()).match(
        /name="consent_token" value="([^"]+)"/,
      )?.[1] ?? "";
    const authorize = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          decision: "approve",
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
          consent_token: consentToken,
        },
      }),
      "/authorize",
    );
    const code = new URL(authorize.headers.get("location")!).searchParams.get(
      "code",
    )!;
    const first = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            grant_type: "authorization_code",
            client_id: client.client_id,
            redirect_uri: "http://localhost:5555/callback",
            code,
            code_verifier: verifier,
          },
        }),
        "/token",
      )
    ).json();

    const missingClientId = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "refresh_token",
          refresh_token: first.refresh_token,
        },
      }),
      "/token",
    );
    expect(missingClientId.status).toBe(400);
    expect(refreshRows.get(first.refresh_token)?.revokedAt).toBeFalsy();

    const mismatch = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "refresh_token",
          client_id: "other-client",
          refresh_token: first.refresh_token,
        },
      }),
      "/token",
    );
    expect(mismatch.status).toBe(400);
    expect(refreshRows.get(first.refresh_token)?.revokedAt).toBeFalsy();

    const retry = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "refresh_token",
          client_id: client.client_id,
          refresh_token: first.refresh_token,
        },
      }),
      "/token",
    );
    expect(retry.status).toBe(200);
  });

  it("expires_in in token response matches the access-token TTL (not hard-coded 3600)", async () => {
    const client = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: { redirect_uris: ["http://localhost:5555/callback"] } as any,
        }),
        "/register",
      )
    ).json();
    const verifier = "v".repeat(50);
    const consent = await handleMcpOAuth(
      event({
        query: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
        },
      }),
      "/authorize",
    );
    const consentToken =
      (await consent.text()).match(
        /name="consent_token" value="([^"]+)"/,
      )?.[1] ?? "";
    const authorize = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          decision: "approve",
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
          consent_token: consentToken,
        },
      }),
      "/authorize",
    );
    const code = new URL(authorize.headers.get("location")!).searchParams.get(
      "code",
    )!;
    const tokenRes = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "authorization_code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          code,
          code_verifier: verifier,
        },
      }),
      "/token",
    );
    const body = await tokenRes.json();
    // expires_in must equal the TTL seconds constant (30d = 2592000s), not 3600.
    expect(body.expires_in).toBe(30 * 86400);
    expect(body.expires_in).not.toBe(3600);
  });

  it("refresh grant expires_in also matches TTL (not hard-coded 3600)", async () => {
    const client = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: { redirect_uris: ["http://localhost:5555/callback"] } as any,
        }),
        "/register",
      )
    ).json();
    const verifier = "v".repeat(50);
    const consent = await handleMcpOAuth(
      event({
        query: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
        },
      }),
      "/authorize",
    );
    const consentToken =
      (await consent.text()).match(
        /name="consent_token" value="([^"]+)"/,
      )?.[1] ?? "";
    const authorize = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          decision: "approve",
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
          consent_token: consentToken,
        },
      }),
      "/authorize",
    );
    const code = new URL(authorize.headers.get("location")!).searchParams.get(
      "code",
    )!;
    const firstToken = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            grant_type: "authorization_code",
            client_id: client.client_id,
            redirect_uri: "http://localhost:5555/callback",
            code,
            code_verifier: verifier,
          },
        }),
        "/token",
      )
    ).json();

    const refreshRes = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "refresh_token",
          client_id: client.client_id,
          refresh_token: firstToken.refresh_token,
        },
      }),
      "/token",
    );
    const refreshBody = await refreshRes.json();
    expect(refreshBody.expires_in).toBe(30 * 86400);
    expect(refreshBody.expires_in).not.toBe(3600);
  });

  it("sliding refresh: touchOAuthRefreshToken extends expiry on each use", async () => {
    const client = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: { redirect_uris: ["http://localhost:5555/callback"] } as any,
        }),
        "/register",
      )
    ).json();
    const verifier = "v".repeat(50);
    const consent = await handleMcpOAuth(
      event({
        query: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
        },
      }),
      "/authorize",
    );
    const consentToken =
      (await consent.text()).match(
        /name="consent_token" value="([^"]+)"/,
      )?.[1] ?? "";
    const authorize = await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          decision: "approve",
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://localhost:5555/callback",
          resource: "https://mail.agent-native.com/_agent-native/mcp",
          code_challenge: challenge(verifier),
          code_challenge_method: "S256",
          consent_token: consentToken,
        },
      }),
      "/authorize",
    );
    const code = new URL(authorize.headers.get("location")!).searchParams.get(
      "code",
    )!;
    const firstToken = await (
      await handleMcpOAuth(
        event({
          method: "POST",
          body: {
            grant_type: "authorization_code",
            client_id: client.client_id,
            redirect_uri: "http://localhost:5555/callback",
            code,
            code_verifier: verifier,
          },
        }),
        "/token",
      )
    ).json();

    const rowBefore = refreshRows.get(firstToken.refresh_token);
    expect(rowBefore).toBeTruthy();
    const expiryBefore = rowBefore.expiresAt;

    // Simulate time passing and use the refresh token.
    const laterTime = Date.now() + 1000;
    vi.spyOn(Date, "now").mockReturnValue(laterTime);
    await handleMcpOAuth(
      event({
        method: "POST",
        body: {
          grant_type: "refresh_token",
          client_id: client.client_id,
          refresh_token: firstToken.refresh_token,
        },
      }),
      "/token",
    );

    const rowAfter = refreshRows.get(firstToken.refresh_token);
    // Expiry must have slid forward from the original creation expiry.
    expect(rowAfter.expiresAt).toBeGreaterThan(expiryBefore);
    expect(rowAfter.lastUsedAt).toBe(laterTime);
  });
});
