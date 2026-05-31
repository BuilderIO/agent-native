import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jose from "jose";

// Stub the heavy MCP SDK + builtin-tools so importing build-server.ts is cheap
// — these specs only exercise verifyAuth's revoke-check addition.
vi.mock("./builtin-tools.js", () => ({ getBuiltinCrossAppTools: () => ({}) }));

const isJtiRevokedMock = vi.fn();
const touchTokenUsedMock = vi.fn(async () => {});
const getA2ASecretByDomainMock = vi.fn();
vi.mock("./connect-store.js", () => ({
  MCP_CONNECT_SCOPE: "mcp-connect",
  MCP_CONNECT_OAUTH_CLIENT_ID: "agent-native-connect",
  isJtiRevoked: (...a: any[]) => isJtiRevokedMock(...a),
  touchTokenUsed: (...a: any[]) => touchTokenUsedMock(...a),
}));
vi.mock("../org/context.js", () => ({
  getA2ASecretByDomain: (...a: any[]) => getA2ASecretByDomainMock(...a),
  resolveOrgByDomain: vi.fn(async () => null),
}));

const { verifyAuth } = await import("./build-server.js");
const { signMcpOAuthAccessToken } = await import("./oauth-token.js");

const SECRET = "verify-auth-secret";

async function sign(
  claims: Record<string, unknown>,
  secret = SECRET,
): Promise<string> {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

describe("verifyAuth — connect-token revoke check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getA2ASecretByDomainMock.mockResolvedValue(null);
    process.env.A2A_SECRET = SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.ACCESS_TOKEN;
    delete process.env.ACCESS_TOKENS;
  });
  afterEach(() => {
    delete process.env.A2A_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
  });

  it("does NOT query the revoke store for an ordinary A2A JWT (hot path untouched)", async () => {
    const token = await sign({ sub: "a@example.com" });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("a@example.com");
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
  });

  it("accepts an ordinary A2A JWT signed with the caller org secret", async () => {
    process.env.A2A_SECRET = "different-global-secret";
    getA2ASecretByDomainMock.mockResolvedValue("org-a2a-secret");
    const token = await sign(
      { sub: "a@example.com", org_domain: "builder.io" },
      "org-a2a-secret",
    );

    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      allowDevOpen: false,
    });

    expect(res.authed).toBe(true);
    expect(res.identity).toEqual({
      userEmail: "a@example.com",
      orgDomain: "builder.io",
    });
    expect(res.fullSurface).toBe(true);
    expect(getA2ASecretByDomainMock).toHaveBeenCalledWith("builder.io");
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
  });

  it("rejects identity-scoped SSO JWTs on the MCP endpoint", async () => {
    const token = await sign({
      sub: "a@example.com",
      scope: "identity",
      jti: "identity-jti",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(false);
    expect(res.identity).toBeUndefined();
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
  });

  it("rejects unknown scoped JWTs on the MCP endpoint", async () => {
    const token = await sign({
      sub: "a@example.com",
      scope: "some-other-scope",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(false);
    expect(res.identity).toBeUndefined();
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
  });

  it("accepts a connect-scoped token whose jti is not revoked", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    const token = await sign({
      sub: "a@example.com",
      scope: "mcp-connect",
      jti: "jti-active",
      org_domain: "builder.io",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(true);
    expect(res.identity).toEqual({
      userEmail: "a@example.com",
      orgDomain: "builder.io",
    });
    expect(isJtiRevokedMock).toHaveBeenCalledWith("jti-active");
    expect(touchTokenUsedMock).toHaveBeenCalledWith("jti-active");
  });

  it("accepts an audience-bound standard MCP OAuth access token", async () => {
    const resource = "https://mail.agent-native.com/_agent-native/mcp";
    const token = await signMcpOAuthAccessToken({
      ownerEmail: "oauth@example.com",
      orgId: "org_123",
      orgDomain: "builder.io",
      clientId: "client-123",
      scope: "mcp:read mcp:apps",
      resource,
      issuer: "https://mail.agent-native.com",
    });
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: resource,
    });
    expect(res.authed).toBe(true);
    expect(res.fullSurface).toBe(true);
    expect(res.identity).toEqual({
      userEmail: "oauth@example.com",
      orgId: "org_123",
      orgDomain: "builder.io",
      oauthScopes: ["mcp:read", "mcp:apps"],
      oauthClientId: "client-123",
    });
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
  });

  it("rejects a standard MCP OAuth access token for another resource", async () => {
    const token = await signMcpOAuthAccessToken({
      ownerEmail: "oauth@example.com",
      clientId: "client-123",
      scope: "mcp:read",
      resource: "https://mail.agent-native.com/_agent-native/mcp",
      issuer: "https://mail.agent-native.com",
    });
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: "https://calendar.agent-native.com/_agent-native/mcp",
    });
    expect(res.authed).toBe(false);
    expect(res.identity).toBeUndefined();
  });

  it("accepts a connect-minted MCP OAuth token whose jti is not revoked", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    const resource = "https://mail.agent-native.com/_agent-native/mcp";
    const token = await signMcpOAuthAccessToken({
      ownerEmail: "oauth-connect@example.com",
      clientId: "agent-native-connect",
      scope: "mcp:read mcp:write mcp:apps",
      resource,
      issuer: "https://mail.agent-native.com",
      jti: "jti-oauth-active",
    });
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: resource,
    });
    expect(res.authed).toBe(true);
    expect(res.fullSurface).toBe(true);
    expect(res.identity).toMatchObject({
      userEmail: "oauth-connect@example.com",
      oauthClientId: "agent-native-connect",
    });
    expect(isJtiRevokedMock).toHaveBeenCalledWith("jti-oauth-active");
    expect(touchTokenUsedMock).toHaveBeenCalledWith("jti-oauth-active");
  });

  it("rejects a revoked connect-minted MCP OAuth token", async () => {
    isJtiRevokedMock.mockResolvedValue(true);
    const resource = "https://mail.agent-native.com/_agent-native/mcp";
    const token = await signMcpOAuthAccessToken({
      ownerEmail: "oauth-connect@example.com",
      clientId: "agent-native-connect",
      scope: "mcp:read mcp:write mcp:apps",
      resource,
      issuer: "https://mail.agent-native.com",
      jti: "jti-oauth-revoked",
    });
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: resource,
    });
    expect(res.authed).toBe(false);
    expect(isJtiRevokedMock).toHaveBeenCalledWith("jti-oauth-revoked");
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
  });

  it("rejects a connect-scoped token without a jti", async () => {
    const token = await sign({
      sub: "a@example.com",
      scope: "mcp-connect",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(false);
    expect(res.identity).toBeUndefined();
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
  });

  it("rejects a connect-scoped token whose jti has been revoked", async () => {
    isJtiRevokedMock.mockResolvedValue(true);
    const token = await sign({
      sub: "a@example.com",
      scope: "mcp-connect",
      jti: "jti-revoked",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(false);
    expect(res.identity).toBeUndefined();
  });

  it("fails OPEN: a store error never locks out a valid-signature token", async () => {
    isJtiRevokedMock.mockRejectedValue(new Error("db down"));
    const token = await sign({
      sub: "a@example.com",
      scope: "mcp-connect",
      jti: "jti-x",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    // Signature already verified; a transient DB blip must not 401 everyone.
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("a@example.com");
  });

  it("still rejects a bad signature regardless of scope claim", async () => {
    const forged = await new jose.SignJWT({
      sub: "a@example.com",
      scope: "mcp-connect",
      jti: "jti-x",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("WRONG-SECRET"));
    const res = await verifyAuth(`Bearer ${forged}`);
    expect(res.authed).toBe(false);
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
  });
});

// Bug #3: a connected real caller (connect-minted token / `mcp install` /
// ACCESS_TOKEN / production) must get the FULL MCP tool surface even in local
// dev — the documented external-agents contract. `verifyAuth` reports this via
// `fullSurface`, which `createMCPServerForRequest` uses to swap in
// `config.productionActions`. The pure unauthenticated dev-open path stays
// sparse (`fullSurface: false`).
describe("verifyAuth — fullSurface (real-caller → full MCP surface)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.A2A_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.ACCESS_TOKEN;
    delete process.env.ACCESS_TOKENS;
  });
  afterEach(() => {
    delete process.env.A2A_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.ACCESS_TOKEN;
    delete process.env.ACCESS_TOKENS;
  });

  it("connect-minted JWT → fullSurface true", async () => {
    process.env.A2A_SECRET = SECRET;
    isJtiRevokedMock.mockResolvedValue(false);
    const token = await sign({
      sub: "a@example.com",
      scope: "mcp-connect",
      jti: "jti-connect",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(true);
    expect(res.fullSurface).toBe(true);
  });

  it("ordinary A2A delegation JWT → fullSurface true", async () => {
    process.env.A2A_SECRET = SECRET;
    const token = await sign({ sub: "a@example.com" });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(true);
    expect(res.fullSurface).toBe(true);
  });

  it("matching ACCESS_TOKEN → fullSurface true", async () => {
    process.env.ACCESS_TOKEN = "static-tok";
    const res = await verifyAuth("Bearer static-tok", "owner@example.com");
    expect(res.authed).toBe(true);
    expect(res.fullSurface).toBe(true);
    expect(res.identity?.userEmail).toBe("owner@example.com");
  });

  it("no auth configured + forwarded owner header (mcp install) → authed, fullSurface true", async () => {
    const res = await verifyAuth(undefined, "owner@example.com");
    expect(res.authed).toBe(true);
    expect(res.fullSurface).toBe(true);
  });

  it("no auth configured + no owner header (bare dev probe) → authed, fullSurface false (sparse)", async () => {
    const res = await verifyAuth(undefined, undefined);
    expect(res.authed).toBe(true);
    expect(res.fullSurface).toBe(false);
  });

  it("no auth configured but allowDevOpen:false (deployed, no secret) → rejected", async () => {
    const res = await verifyAuth(undefined, "owner@example.com", {
      allowDevOpen: false,
    });
    expect(res.authed).toBe(false);
  });

  it("standard MCP OAuth token without A2A_SECRET → authed even when dev-open is disabled", async () => {
    process.env.BETTER_AUTH_SECRET = SECRET;
    const resource = "https://mail.agent-native.com/_agent-native/mcp";
    const token = await signMcpOAuthAccessToken({
      ownerEmail: "oauth@example.com",
      clientId: "client-123",
      scope: "mcp:read",
      resource,
      issuer: "https://mail.agent-native.com",
    });
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      allowDevOpen: false,
      resourceUrl: resource,
    });
    expect(res.authed).toBe(true);
    expect(res.fullSurface).toBe(true);
    expect(res.identity).toMatchObject({
      userEmail: "oauth@example.com",
      oauthScopes: ["mcp:read"],
    });
  });
});
