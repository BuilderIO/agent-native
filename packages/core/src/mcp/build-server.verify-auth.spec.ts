import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./builtin-tools.js", () => ({ getBuiltinCrossAppTools: () => ({}) }));

const isJtiRevokedMock = vi.fn();
const touchTokenUsedMock = vi.fn(async () => {});
const lookupConnectTokenOrgMock = vi.fn();
const resolveA2AOrganizationCredentialsByDomainMock = vi.fn();
const resolveA2AOrganizationMetadataByDomainMock = vi.fn();
const resolveA2AOrganizationMetadataByIdMock = vi.fn();
const isOrgMemberForA2AMock = vi.fn();
const resolveOrgByDomainMock = vi.fn();
const resolveOrgIdForEmailMock = vi.fn();
vi.mock("./connect-store.js", () => ({
  MCP_CONNECT_SCOPE: "mcp-connect",
  MCP_CONNECT_OAUTH_CLIENT_ID: "agent-native-connect",
  isJtiRevoked: (...a: any[]) => isJtiRevokedMock(...a),
  touchTokenUsed: (...a: any[]) => touchTokenUsedMock(...a),
  lookupConnectTokenOrg: (...a: any[]) => lookupConnectTokenOrgMock(...a),
}));
vi.mock("../org/context.js", () => ({
  resolveA2AOrganizationCredentialsByDomain: (...a: any[]) =>
    resolveA2AOrganizationCredentialsByDomainMock(...a),
  resolveA2AOrganizationMetadataByDomain: (...a: any[]) =>
    resolveA2AOrganizationMetadataByDomainMock(...a),
  resolveA2AOrganizationMetadataById: (...a: any[]) =>
    resolveA2AOrganizationMetadataByIdMock(...a),
  resolveOrgByDomain: (...a: any[]) => resolveOrgByDomainMock(...a),
  resolveOrgIdForEmail: (...a: any[]) => resolveOrgIdForEmailMock(...a),
}));
vi.mock("../org/membership.js", () => ({
  isOrgMemberForA2A: (...a: any[]) => isOrgMemberForA2AMock(...a),
}));
const checkCredentialOrgMembershipMock = vi.fn(async () => "member");
const checkCredentialEmailRetirementMock = vi.fn(async () => "current");
vi.mock("./credential-membership.js", () => ({
  checkCredentialOrgMembership: (...a: any[]) =>
    checkCredentialOrgMembershipMock(...a),
  checkCredentialEmailRetirement: (...a: any[]) =>
    checkCredentialEmailRetirementMock(...a),
}));

const { resolveMcpIdentityOrgId, verifyAuth } =
  await import("./build-server.js");
const { signMcpOAuthAccessToken } = await import("./oauth-token.js");

const SECRET = "verify-auth-secret";

async function sign(
  claims: Record<string, unknown>,
  secret = SECRET,
  options: { audience?: string } = {},
): Promise<string> {
  const jwt = new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h");
  if (options.audience) jwt.setAudience(options.audience);
  return jwt.sign(new TextEncoder().encode(secret));
}

describe("verifyAuth — connect-token revoke check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupConnectTokenOrgMock.mockResolvedValue({ status: "missing" });
    resolveA2AOrganizationCredentialsByDomainMock.mockResolvedValue(null);
    resolveA2AOrganizationMetadataByDomainMock.mockResolvedValue(null);
    resolveA2AOrganizationMetadataByIdMock.mockResolvedValue(null);
    isOrgMemberForA2AMock.mockResolvedValue(true);
    resolveOrgByDomainMock.mockResolvedValue(null);
    resolveOrgIdForEmailMock.mockResolvedValue(null);
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

  it("accepts an audience-bound ordinary A2A JWT for this MCP endpoint", async () => {
    const resourceUrl = "https://assets.example.com/_agent-native/mcp";
    const token = await sign({ sub: "a@example.com" }, SECRET, {
      audience: resourceUrl,
    });

    const res = await verifyAuth(`Bearer ${token}`, undefined, { resourceUrl });

    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("a@example.com");
  });

  it("rejects an ordinary A2A JWT whose audience targets another app", async () => {
    const token = await sign({ sub: "a@example.com" }, SECRET, {
      audience: "https://design.example.com/_agent-native/mcp",
    });

    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: "https://assets.example.com/_agent-native/mcp",
    });

    expect(res).toEqual({ authed: false, refusal: "invalid" });
  });

  it("rejects an audience-bound ordinary A2A JWT when the resource URL is unknown", async () => {
    const token = await sign({ sub: "a@example.com" }, SECRET, {
      audience: "https://assets.example.com/_agent-native/mcp",
    });

    const res = await verifyAuth(`Bearer ${token}`);

    expect(res).toEqual({ authed: false, refusal: "invalid" });
  });

  it("accepts an org-secret A2A JWT without treating its subject as a user", async () => {
    process.env.A2A_SECRET = "different-global-secret";
    resolveA2AOrganizationCredentialsByDomainMock.mockResolvedValue({
      orgId: "org-builder",
      orgDomain: "builder.io",
      secret: "org-a2a-secret",
    });
    const token = await sign(
      { sub: "a@example.com", org_domain: "builder.io" },
      "org-a2a-secret",
    );

    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      allowDevOpen: false,
    });

    expect(res.authed).toBe(true);
    expect(res.identity).toEqual({
      userEmail: undefined,
      identityAssurance: "organization",
      orgId: "org-builder",
      orgDomain: "builder.io",
    });
    expect(res.fullSurface).toBe(true);
    expect(resolveA2AOrganizationCredentialsByDomainMock).toHaveBeenCalledWith(
      "builder.io",
    );
    expect(isOrgMemberForA2AMock).not.toHaveBeenCalled();
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
  });

  it("ignores a forged subject on an org-secret token", async () => {
    delete process.env.A2A_SECRET;
    resolveA2AOrganizationCredentialsByDomainMock.mockResolvedValue({
      orgId: "org-evil",
      orgDomain: "evil.example",
      secret: "org-evil-secret",
    });
    const token = await sign(
      { sub: "alice@acme", org_domain: "evil.example", org_id: "org-evil" },
      "org-evil-secret",
    );

    const res = await verifyAuth(`Bearer ${token}`, "alice@acme");

    expect(res).toMatchObject({
      authed: true,
      identity: { orgId: "org-evil", orgDomain: "evil.example" },
    });
    expect(res.identity?.userEmail).toBeUndefined();
    expect(isOrgMemberForA2AMock).not.toHaveBeenCalled();
  });

  it("rejects org-secret tokens whose org_id differs from the verified domain org", async () => {
    delete process.env.A2A_SECRET;
    resolveA2AOrganizationCredentialsByDomainMock.mockResolvedValue({
      orgId: "org-evil",
      orgDomain: "evil.example",
      secret: "org-evil-secret",
    });
    const token = await sign(
      { sub: "alice@acme", org_domain: "evil.example", org_id: "org-acme" },
      "org-evil-secret",
    );

    const res = await verifyAuth(`Bearer ${token}`, "alice@acme");

    expect(res).toEqual({ authed: false, refusal: "invalid" });
    expect(isOrgMemberForA2AMock).not.toHaveBeenCalled();
  });

  it("preserves unavailable organization credential lookup instead of returning invalid auth", async () => {
    process.env.A2A_SECRET = "different-global-secret";
    resolveA2AOrganizationCredentialsByDomainMock.mockRejectedValue(
      new Error("database unavailable"),
    );
    const token = await sign(
      { sub: "alice@acme", org_domain: "evil.example" },
      "org-evil-secret",
    );

    await expect(verifyAuth(`Bearer ${token}`, "alice@acme")).resolves.toEqual({
      authed: false,
      unavailable: true,
    });
    expect(isOrgMemberForA2AMock).not.toHaveBeenCalled();
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
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "a@example.com",
      orgId: null,
    });
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
      identityAssurance: "user",
      orgId: null,
      orgDomain: "builder.io",
    });
    expect(isJtiRevokedMock).toHaveBeenCalledWith("jti-active");
    expect(touchTokenUsedMock).toHaveBeenCalledWith("jti-active");
  });

  it("rejects a non-first-party connect token this app has no record of", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    lookupConnectTokenOrgMock.mockResolvedValue({ status: "missing" });
    const token = await sign({
      sub: "a@example.com",
      scope: "mcp-connect",
      jti: "jti-unknown",
      org_domain: "builder.io",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res).toEqual({ authed: false, refusal: "unknown-connect-token" });
    expect(checkCredentialOrgMembershipMock).not.toHaveBeenCalled();
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
  });

  it("restores org scope for a legacy connect JWT from its stored token row", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "ci@example.com",
      orgId: "org_legacy",
    });
    const token = await sign({
      sub: "ci@example.com",
      scope: "mcp-connect",
      jti: "jti-legacy",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(true);
    expect(res.identity).toEqual({
      userEmail: "ci@example.com",
      identityAssurance: "user",
      orgId: "org_legacy",
      orgDomain: undefined,
    });
    expect(lookupConnectTokenOrgMock).toHaveBeenCalledWith("jti-legacy");
  });

  it("preserves Personal scope for a legacy connect JWT from its stored row", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "ci@example.com",
      orgId: null,
    });
    const token = await sign({
      sub: "ci@example.com",
      scope: "mcp-connect",
      jti: "jti-personal",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(true);
    expect(res.identity).toEqual({
      userEmail: "ci@example.com",
      identityAssurance: "user",
      orgId: null,
      orgDomain: undefined,
    });
    expect(lookupConnectTokenOrgMock).toHaveBeenCalledWith("jti-personal");
  });

  it("refuses a legacy connect JWT with a retryable failure when its org lookup is unavailable", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    lookupConnectTokenOrgMock.mockResolvedValue({ status: "unavailable" });
    const token = await sign({
      sub: "ci@example.com",
      scope: "mcp-connect",
      jti: "jti-unavailable",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res).toEqual({ authed: false, unavailable: true });
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
  });

  it.each([123, { id: "org_123" }, ""])(
    "rejects an A2A JWT with malformed org_id: %j",
    async (orgId) => {
      const token = await sign({
        sub: "ci@example.com",
        org_id: orgId,
      });
      const res = await verifyAuth(`Bearer ${token}`);
      expect(res).toEqual({ authed: false, refusal: "invalid" });
      expect(lookupConnectTokenOrgMock).not.toHaveBeenCalled();
    },
  );

  it("preserves the framework first-party MCP marker from audience-bound connect-scoped tokens", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    resolveA2AOrganizationMetadataByIdMock.mockResolvedValue({
      orgId: "org_123",
      orgDomain: null,
    });
    const token = await sign(
      {
        sub: "svc-mcp-client@service.org_123",
        scope: "mcp-connect",
        jti: "jti-first-party",
        org_id: "org_123",
        agent_native_first_party_mcp: true,
      },
      SECRET,
      {
        audience: "https://assets.example.com/_agent-native/mcp",
      },
    );
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: "https://assets.example.com/_agent-native/mcp",
    });
    expect(res.authed).toBe(true);
    expect(res.identity).toMatchObject({
      userEmail: "svc-mcp-client@service.org_123",
      orgId: "org_123",
      firstPartyMcp: true,
    });
  });

  it("rejects a first-party MCP token without an audience", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    const token = await sign({
      sub: "svc-mcp-client@service.org_123",
      scope: "mcp-connect",
      jti: "jti-first-party-no-aud",
      org_id: "org_123",
      agent_native_first_party_mcp: true,
    });
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: "https://assets.example.com/_agent-native/mcp",
    });
    expect(res.authed).toBe(false);
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
  });

  it("rejects a first-party MCP token audience-bound to another app", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    const token = await sign(
      {
        sub: "svc-mcp-client@service.org_123",
        scope: "mcp-connect",
        jti: "jti-first-party-wrong-aud",
        org_id: "org_123",
        agent_native_first_party_mcp: true,
      },
      SECRET,
      {
        audience: "https://assets.example.com/_agent-native/mcp",
      },
    );
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: "https://design.example.com/_agent-native/mcp",
    });
    expect(res.authed).toBe(false);
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
  });

  it("resolves an org SERVICE token to a synthetic service identity with orgId", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "service",
      ownerEmail: "svc-ci@service.org_123",
      orgId: "org_123",
    });
    const token = await sign({
      sub: "svc-ci@service.org_123",
      scope: "mcp-connect",
      jti: "jti-svc",
      org_id: "org_123",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(true);
    expect(res.identity).toEqual({
      userEmail: "svc-ci@service.org_123",
      identityAssurance: "service",
      orgId: "org_123",
      orgDomain: undefined,
    });
    expect(res.fullSurface).toBe(true);
    expect(isJtiRevokedMock).toHaveBeenCalledWith("jti-svc");
  });

  it("rejects a revoked org SERVICE token (same revocation gate as personal)", async () => {
    isJtiRevokedMock.mockResolvedValue(true);
    const token = await sign({
      sub: "svc-ci@service.org_123",
      scope: "mcp-connect",
      jti: "jti-svc-revoked",
      org_id: "org_123",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(false);
    expect(isJtiRevokedMock).toHaveBeenCalledWith("jti-svc-revoked");
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
      identityAssurance: "user",
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
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "oauth-connect@example.com",
      orgId: null,
    });
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

  it("restores org scope for a legacy connect OAuth token from its stored token row", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "oauth-connect@example.com",
      orgId: "org_legacy",
    });
    const resource = "https://mail.agent-native.com/_agent-native/mcp";
    const token = await signMcpOAuthAccessToken({
      ownerEmail: "oauth-connect@example.com",
      clientId: "agent-native-connect",
      scope: "mcp:read mcp:write mcp:apps",
      resource,
      issuer: "https://mail.agent-native.com",
      jti: "jti-oauth-legacy",
    });
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: resource,
    });
    expect(res.authed).toBe(true);
    expect(res.identity).toMatchObject({
      userEmail: "oauth-connect@example.com",
      orgId: "org_legacy",
      oauthClientId: "agent-native-connect",
    });
    expect(lookupConnectTokenOrgMock).toHaveBeenCalledWith("jti-oauth-legacy");
  });

  it("refuses a legacy connect OAuth token with a retryable failure when its org lookup is unavailable", async () => {
    isJtiRevokedMock.mockResolvedValue(false);
    lookupConnectTokenOrgMock.mockResolvedValue({ status: "unavailable" });
    const resource = "https://mail.agent-native.com/_agent-native/mcp";
    const token = await signMcpOAuthAccessToken({
      ownerEmail: "oauth-connect@example.com",
      clientId: "agent-native-connect",
      scope: "mcp:read mcp:write mcp:apps",
      resource,
      issuer: "https://mail.agent-native.com",
      jti: "jti-oauth-unavailable",
    });
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: resource,
    });
    expect(res).toEqual({ authed: false, unavailable: true });
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
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

  it("answers a retryable outage for a connect-minted MCP OAuth token whose revocation state can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    isJtiRevokedMock.mockRejectedValue(new Error("db down"));
    const resource = "https://mail.agent-native.com/_agent-native/mcp";
    const token = await signMcpOAuthAccessToken({
      ownerEmail: "oauth-connect@example.com",
      clientId: "agent-native-connect",
      scope: "mcp:read mcp:write mcp:apps",
      resource,
      issuer: "https://mail.agent-native.com",
      jti: "jti-oauth-unreadable",
    });
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: resource,
    });
    expect(res).toEqual({ authed: false, unavailable: true });
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

  it("answers a retryable outage, not admission, when revocation state can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    isJtiRevokedMock.mockRejectedValue(new Error("db down"));
    const token = await sign({
      sub: "a@example.com",
      scope: "mcp-connect",
      jti: "jti-x",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res).toEqual({ authed: false, unavailable: true });
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
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
    lookupConnectTokenOrgMock.mockResolvedValue({ status: "missing" });
    resolveA2AOrganizationCredentialsByDomainMock.mockResolvedValue(null);
    resolveA2AOrganizationMetadataByDomainMock.mockResolvedValue(null);
    resolveA2AOrganizationMetadataByIdMock.mockResolvedValue(null);
    isOrgMemberForA2AMock.mockResolvedValue(true);
    resolveOrgByDomainMock.mockResolvedValue(null);
    resolveOrgIdForEmailMock.mockResolvedValue(null);
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
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "a@example.com",
      orgId: null,
    });
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

  it("accepts bearer auth scheme case-insensitively with flexible spacing", async () => {
    process.env.ACCESS_TOKEN = "static-tok";
    const res = await verifyAuth(
      "  bearer   static-tok  ",
      "owner@example.com",
    );
    expect(res.authed).toBe(true);
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

  it("accepts standard MCP OAuth tokens with lowercase bearer headers", async () => {
    process.env.BETTER_AUTH_SECRET = SECRET;
    const resource = "https://mail.agent-native.com/_agent-native/mcp";
    const token = await signMcpOAuthAccessToken({
      ownerEmail: "oauth@example.com",
      clientId: "client-123",
      scope: "mcp:read",
      resource,
      issuer: "https://mail.agent-native.com",
    });
    const res = await verifyAuth(`bearer  ${token}`, undefined, {
      allowDevOpen: false,
      resourceUrl: resource,
    });
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("oauth@example.com");
  });
});

describe("verifyAuth — the token's organization must still be the user's", () => {
  const resource = "https://mail.agent-native.com/mcp";

  function oauthToken(orgId: string | null) {
    return signMcpOAuthAccessToken({
      ownerEmail: "oauth@example.com",
      orgId,
      orgDomain: null,
      clientId: "client-123",
      scope: "mcp:read",
      resource,
      issuer: "https://mail.agent-native.com",
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    checkCredentialOrgMembershipMock.mockResolvedValue("member");
    isOrgMemberForA2AMock.mockReset();
    isOrgMemberForA2AMock.mockResolvedValue(true);
    lookupConnectTokenOrgMock.mockResolvedValue({ status: "missing" });
    resolveA2AOrganizationCredentialsByDomainMock.mockResolvedValue(null);
    resolveA2AOrganizationMetadataByDomainMock.mockResolvedValue(null);
    resolveA2AOrganizationMetadataByIdMock.mockResolvedValue(null);
    isJtiRevokedMock.mockResolvedValue(false);
    process.env.A2A_SECRET = SECRET;
    delete process.env.ACCESS_TOKEN;
    delete process.env.ACCESS_TOKENS;
  });
  afterEach(() => {
    delete process.env.A2A_SECRET;
  });

  it("admits an OAuth token while its user is still a member of its org", async () => {
    const res = await verifyAuth(
      `Bearer ${await oauthToken("org_123")}`,
      undefined,
      {
        resourceUrl: resource,
        requestOrigin: "https://mail.agent-native.com",
      },
    );
    expect(res).toMatchObject({
      authed: true,
      identity: { userEmail: "oauth@example.com", orgId: "org_123" },
    });
    expect(checkCredentialOrgMembershipMock).toHaveBeenCalledTimes(1);
    expect(checkCredentialOrgMembershipMock).toHaveBeenCalledWith({
      orgId: "org_123",
      email: "oauth@example.com",
      requestOrigin: "https://mail.agent-native.com",
    });
  });

  it("rejects an OAuth token once its user has left its org", async () => {
    checkCredentialOrgMembershipMock.mockResolvedValue("not-member");
    const res = await verifyAuth(
      `Bearer ${await oauthToken("org_123")}`,
      undefined,
      {
        resourceUrl: resource,
      },
    );
    expect(res).toEqual({ authed: false, refusal: "not-member" });
  });

  it("fails closed, and says so, when the membership check cannot run", async () => {
    checkCredentialOrgMembershipMock.mockResolvedValue("unavailable");
    const res = await verifyAuth(
      `Bearer ${await oauthToken("org_123")}`,
      undefined,
      {
        resourceUrl: resource,
      },
    );
    expect(res).toEqual({ authed: false, unavailable: true });
  });

  it("does not check membership for a Personal-scope token", async () => {
    const res = await verifyAuth(
      `Bearer ${await oauthToken(null)}`,
      undefined,
      {
        resourceUrl: resource,
      },
    );
    expect(res).toMatchObject({ authed: true, identity: { orgId: null } });
    expect(checkCredentialOrgMembershipMock).not.toHaveBeenCalled();
  });

  it("binds an A2A token's domain-only org claim to local metadata without receiver membership", async () => {
    isOrgMemberForA2AMock.mockResolvedValue(false);
    resolveA2AOrganizationMetadataByDomainMock.mockResolvedValue({
      orgId: "org_builder",
      orgDomain: "builder.io",
    });
    const token = await sign({
      sub: "a@example.com",
      org_domain: "builder.io",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(true);
    expect(res.identity?.orgId).toBe("org_builder");
    expect(checkCredentialOrgMembershipMock).not.toHaveBeenCalled();
    expect(isOrgMemberForA2AMock).not.toHaveBeenCalled();
  });

  it("checks the stored org of a legacy connect token", async () => {
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "ci@example.com",
      orgId: "org_legacy",
    });
    checkCredentialOrgMembershipMock.mockResolvedValue("not-member");
    const token = await sign({
      sub: "ci@example.com",
      scope: "mcp-connect",
      jti: "jti-legacy",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res).toEqual({ authed: false, refusal: "not-member" });
    expect(checkCredentialOrgMembershipMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_legacy",
        email: "ci@example.com",
      }),
    );
  });

  it("checks the org claim of a connect token", async () => {
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "service",
      ownerEmail: "svc-ci@service.org_123",
      orgId: "org_123",
    });
    checkCredentialOrgMembershipMock.mockResolvedValue("not-member");
    const token = await sign({
      sub: "svc-ci@service.org_123",
      scope: "mcp-connect",
      jti: "jti-service",
      org_id: "org_123",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res).toEqual({ authed: false, refusal: "not-member" });
    expect(checkCredentialOrgMembershipMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_123",
        email: "svc-ci@service.org_123",
      }),
    );
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
  });

  it("rejects a connect token whose subject or org claim differs from its stored row", async () => {
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "ci@example.com",
      orgId: "org_123",
    });
    const token = await sign({
      sub: "other@example.com",
      scope: "mcp-connect",
      jti: "jti-mismatch",
      org_id: "org_other",
    });

    expect(await verifyAuth(`Bearer ${token}`)).toEqual({
      authed: false,
      refusal: "identity-mismatch",
    });
    expect(checkCredentialOrgMembershipMock).not.toHaveBeenCalled();
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
  });

  it("rejects an org-bearing connect token without local JTI provenance", async () => {
    lookupConnectTokenOrgMock.mockResolvedValue({ status: "missing" });
    const token = await sign({
      sub: "ci@example.com",
      scope: "mcp-connect",
      jti: "jti-untracked-org",
      org_id: "org_123",
    });

    expect(await verifyAuth(`Bearer ${token}`)).toEqual({
      authed: false,
      refusal: "unknown-connect-token",
    });
    expect(checkCredentialOrgMembershipMock).not.toHaveBeenCalled();
  });

  it.each(["legacy", "oauth"])(
    "passes local service provenance for an authenticated %s connect credential with an org claim",
    async (transport) => {
      const stored = {
        status: "found",
        kind: "service",
        ownerEmail: "svc-ci@service.org_123",
        orgId: "org_123",
      };
      lookupConnectTokenOrgMock.mockResolvedValue(stored);
      const token =
        transport === "legacy"
          ? await sign({
              sub: stored.ownerEmail,
              scope: "mcp-connect",
              jti: "jti-service-provenance",
              org_id: stored.orgId,
            })
          : await signMcpOAuthAccessToken({
              ownerEmail: stored.ownerEmail,
              orgId: stored.orgId,
              clientId: "agent-native-connect",
              jti: "jti-service-provenance",
              scope: "mcp:read",
              resource,
              issuer: "https://mail.agent-native.com",
            });

      expect(
        (
          await verifyAuth(`Bearer ${token}`, undefined, {
            resourceUrl: resource,
          })
        ).authed,
      ).toBe(true);
      expect(lookupConnectTokenOrgMock).toHaveBeenCalledWith(
        "jti-service-provenance",
      );
      expect(checkCredentialOrgMembershipMock).toHaveBeenCalledWith({
        orgId: stored.orgId,
        email: stored.ownerEmail,
        requestOrigin: undefined,
        storedConnectToken: stored,
      });
    },
  );

  it("answers a retryable failure for a connect token with an org claim when stored provenance is unreadable", async () => {
    lookupConnectTokenOrgMock.mockResolvedValue({ status: "unavailable" });
    const token = await sign({
      sub: "svc-ci@service.org_123",
      scope: "mcp-connect",
      jti: "jti-service-provenance-unavailable",
      org_id: "org_123",
    });
    expect(await verifyAuth(`Bearer ${token}`)).toEqual({
      authed: false,
      unavailable: true,
    });
    expect(checkCredentialOrgMembershipMock).not.toHaveBeenCalled();
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
  });

  it("does not record use of a connect token it cannot admit", async () => {
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "ci@example.com",
      orgId: "org_123",
    });
    checkCredentialOrgMembershipMock.mockResolvedValue("unavailable");
    const token = await sign({
      sub: "ci@example.com",
      scope: "mcp-connect",
      jti: "jti-unchecked",
      org_id: "org_123",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res).toEqual({ authed: false, unavailable: true });
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
  });

  it("records use of a connect token once its user is confirmed as a member", async () => {
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "ci@example.com",
      orgId: "org_123",
    });
    const token = await sign({
      sub: "ci@example.com",
      scope: "mcp-connect",
      jti: "jti-member",
      org_id: "org_123",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res).toMatchObject({ authed: true, identity: { orgId: "org_123" } });
    expect(touchTokenUsedMock).toHaveBeenCalledWith("jti-member");
  });

  it("accepts a globally signed A2A org claim with local metadata and no receiver membership", async () => {
    checkCredentialOrgMembershipMock.mockResolvedValue("not-member");
    isOrgMemberForA2AMock.mockResolvedValue(false);
    resolveA2AOrganizationMetadataByDomainMock.mockResolvedValue({
      orgId: "org_123",
      orgDomain: "builder.io",
    });
    const token = await sign({
      sub: "a@example.com",
      org_domain: "builder.io",
      org_id: "org_123",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res).toMatchObject({
      authed: true,
      identity: {
        userEmail: "a@example.com",
        orgId: "org_123",
        orgDomain: "builder.io",
      },
    });
    expect(checkCredentialOrgMembershipMock).not.toHaveBeenCalled();
    expect(isOrgMemberForA2AMock).not.toHaveBeenCalled();
  });

  it("rejects a globally signed A2A org claim that conflicts with local domain metadata", async () => {
    resolveA2AOrganizationMetadataByDomainMock.mockResolvedValue({
      orgId: "org_builder",
      orgDomain: "builder.io",
    });
    const token = await sign({
      sub: "a@example.com",
      org_domain: "builder.io",
      org_id: "org_evil",
    });

    await expect(verifyAuth(`Bearer ${token}`)).resolves.toEqual({
      authed: false,
      refusal: "invalid",
    });
    expect(isOrgMemberForA2AMock).not.toHaveBeenCalled();
  });

  it("keeps global org identity unavailable when local metadata cannot be read", async () => {
    resolveA2AOrganizationMetadataByDomainMock.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const token = await sign({
      sub: "a@example.com",
      org_domain: "builder.io",
      org_id: "org_123",
    });

    await expect(verifyAuth(`Bearer ${token}`)).resolves.toEqual({
      authed: false,
      unavailable: true,
    });
    expect(isOrgMemberForA2AMock).not.toHaveBeenCalled();
  });

  it("accepts a domain-only A2A claim for a user absent from receiver membership", async () => {
    resolveA2AOrganizationMetadataByDomainMock.mockResolvedValue({
      orgId: "org_builder",
      orgDomain: "builder.io",
    });
    isOrgMemberForA2AMock.mockResolvedValue(false);
    const token = await sign({
      sub: "alice@acme.test",
      org_domain: "builder.io",
    });

    expect(await verifyAuth(`Bearer ${token}`)).toMatchObject({
      authed: true,
      identity: {
        userEmail: "alice@acme.test",
        orgId: "org_builder",
        orgDomain: "builder.io",
      },
    });
    expect(isOrgMemberForA2AMock).not.toHaveBeenCalled();
  });

  it("trusts the org claim of a first-party MCP token from a sibling app", async () => {
    checkCredentialOrgMembershipMock.mockResolvedValue("not-member");
    isOrgMemberForA2AMock.mockResolvedValue(false);
    resolveA2AOrganizationMetadataByDomainMock.mockResolvedValue({
      orgId: "org_123",
      orgDomain: "builder.io",
    });
    const token = await sign(
      {
        sub: "a@example.com",
        org_domain: "builder.io",
        scope: "mcp-connect",
        jti: "jti-first-party-member",
        org_id: "org_123",
        agent_native_first_party_mcp: true,
      },
      SECRET,
      { audience: "https://assets.example.com/_agent-native/mcp" },
    );
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: "https://assets.example.com/_agent-native/mcp",
    });
    expect(res).toMatchObject({
      authed: true,
      identity: {
        userEmail: "a@example.com",
        orgId: "org_123",
        firstPartyMcp: true,
      },
    });
    expect(checkCredentialOrgMembershipMock).not.toHaveBeenCalled();
    expect(isOrgMemberForA2AMock).not.toHaveBeenCalled();
  });

  it("binds a domain-only first-party token to the receiver's local organization", async () => {
    resolveA2AOrganizationMetadataByDomainMock.mockResolvedValue({
      orgId: "recipient-org-by-domain",
      orgDomain: "builder.io",
    });
    const token = await sign(
      {
        sub: "a@example.com",
        scope: "mcp-connect",
        jti: "jti-first-party-domain-bound",
        org_domain: "builder.io",
        agent_native_first_party_mcp: true,
      },
      SECRET,
      { audience: "https://assets.example.com/_agent-native/mcp" },
    );
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: "https://assets.example.com/_agent-native/mcp",
    });
    expect(res).toMatchObject({
      authed: true,
      identity: {
        userEmail: "a@example.com",
        orgId: "recipient-org-by-domain",
        orgDomain: "builder.io",
        firstPartyMcp: true,
      },
    });
    expect(resolveA2AOrganizationMetadataByDomainMock).toHaveBeenCalledWith(
      "builder.io",
    );
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
    expect(checkCredentialOrgMembershipMock).not.toHaveBeenCalled();
  });

  it("preserves Personal scope for an unclaimed first-party token without org claims", async () => {
    const token = await sign(
      {
        sub: "a@example.com",
        scope: "mcp-connect",
        jti: "jti-first-party-unclaimed",
        agent_native_first_party_mcp: true,
      },
      SECRET,
      { audience: "https://assets.example.com/_agent-native/mcp" },
    );
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: "https://assets.example.com/_agent-native/mcp",
    });
    expect(res).toMatchObject({ authed: true, identity: { orgId: null } });
    await expect(
      resolveMcpIdentityOrgId(res.identity),
    ).resolves.toBeUndefined();
    expect(resolveA2AOrganizationMetadataByDomainMock).not.toHaveBeenCalled();
    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
    expect(lookupConnectTokenOrgMock).not.toHaveBeenCalled();
    expect(checkCredentialOrgMembershipMock).not.toHaveBeenCalled();
  });
});

describe("verifyAuth — a credential for an address an email change retired", () => {
  const resource = "https://mail.agent-native.com/mcp";

  beforeEach(() => {
    vi.clearAllMocks();
    checkCredentialOrgMembershipMock.mockResolvedValue("member");
    checkCredentialEmailRetirementMock.mockResolvedValue("current");
    lookupConnectTokenOrgMock.mockResolvedValue({ status: "missing" });
    resolveA2AOrganizationCredentialsByDomainMock.mockResolvedValue(null);
    resolveA2AOrganizationMetadataByDomainMock.mockResolvedValue(null);
    resolveA2AOrganizationMetadataByIdMock.mockResolvedValue(null);
    isJtiRevokedMock.mockResolvedValue(false);
    process.env.A2A_SECRET = SECRET;
    delete process.env.ACCESS_TOKEN;
    delete process.env.ACCESS_TOKENS;
  });
  afterEach(() => {
    delete process.env.A2A_SECRET;
  });

  it("refuses a Personal OAuth token signed before its address was renamed away", async () => {
    checkCredentialEmailRetirementMock.mockResolvedValue("retired");
    const token = await signMcpOAuthAccessToken({
      ownerEmail: "renamed@example.com",
      orgId: null,
      orgDomain: null,
      clientId: "client-123",
      scope: "mcp:read",
      resource,
      issuer: "https://mail.agent-native.com",
    });
    const res = await verifyAuth(`Bearer ${token}`, undefined, {
      resourceUrl: resource,
    });
    expect(res).toEqual({ authed: false, refusal: "email-retired" });
    expect(checkCredentialEmailRetirementMock).toHaveBeenCalledWith({
      email: "renamed@example.com",
      issuedAt: expect.any(Number),
    });
  });

  it("refuses a Personal connect token for a retired address and records no use", async () => {
    checkCredentialEmailRetirementMock.mockResolvedValue("retired");
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "renamed@example.com",
      orgId: null,
    });
    const token = await sign({
      sub: "renamed@example.com",
      scope: "mcp-connect",
      jti: "jti-renamed",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res).toEqual({ authed: false, refusal: "email-retired" });
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
  });

  it("answers a retryable failure when the retirement check cannot run", async () => {
    checkCredentialEmailRetirementMock.mockResolvedValue("unavailable");
    lookupConnectTokenOrgMock.mockResolvedValue({
      status: "found",
      kind: "personal",
      ownerEmail: "renamed@example.com",
      orgId: null,
    });
    const token = await sign({
      sub: "renamed@example.com",
      scope: "mcp-connect",
      jti: "jti-unreadable",
    });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res).toEqual({ authed: false, unavailable: true });
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
  });

  it("leaves a cross-app A2A token to its signer", async () => {
    checkCredentialEmailRetirementMock.mockResolvedValue("retired");
    const res = await verifyAuth(
      `Bearer ${await sign({ sub: "renamed@example.com" })}`,
    );
    expect(res).toMatchObject({
      authed: true,
      identity: { userEmail: "renamed@example.com" },
    });
    expect(checkCredentialEmailRetirementMock).not.toHaveBeenCalled();
  });
});

describe("resolveMcpIdentityOrgId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrgByDomainMock.mockResolvedValue(null);
    resolveOrgIdForEmailMock.mockResolvedValue(null);
  });

  it("uses an explicit org_id claim without extra lookup", async () => {
    await expect(
      resolveMcpIdentityOrgId({
        userEmail: "alice@example.com",
        orgId: "org-explicit",
        orgDomain: "example.com",
      }),
    ).resolves.toBe("org-explicit");

    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it("preserves explicit Personal scope without an email fallback", async () => {
    resolveOrgIdForEmailMock.mockResolvedValue("org-email");

    await expect(
      resolveMcpIdentityOrgId({
        userEmail: "alice@example.com",
        orgId: null,
        orgDomain: undefined,
      }),
    ).resolves.toBeUndefined();

    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it("resolves verified org_domain before falling back to email membership", async () => {
    resolveOrgByDomainMock.mockResolvedValue({ orgId: "org-domain" });
    resolveOrgIdForEmailMock.mockResolvedValue("org-email");

    await expect(
      resolveMcpIdentityOrgId({
        userEmail: "alice@example.com",
        orgDomain: "example.com",
      }),
    ).resolves.toBe("org-domain");

    expect(resolveOrgByDomainMock).toHaveBeenCalledWith("example.com");
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it("falls back to the verified user email when a token has no org claim", async () => {
    resolveOrgIdForEmailMock.mockResolvedValue("org-email");

    await expect(
      resolveMcpIdentityOrgId({
        userEmail: "alice@example.com",
        orgDomain: undefined,
      }),
    ).resolves.toBe("org-email");

    expect(resolveOrgIdForEmailMock).toHaveBeenCalledWith("alice@example.com");
  });
});
