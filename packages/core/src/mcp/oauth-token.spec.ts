import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * oauth-token mints and verifies the signed JWT access tokens for the standard
 * remote MCP OAuth flow. Tokens are HS256 JWTs keyed on `A2A_SECRET` (falling
 * back to the better-auth secret). We mock only the secret provider and use the
 * REAL jose sign/verify so the audience binding, typ guard, scope guard, and
 * expiry are exercised as in production.
 */

vi.mock("../server/better-auth-instance.js", () => ({
  getAuthSecret: () => "fallback-auth-secret",
}));

import {
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  MCP_OAUTH_DEFAULT_SCOPE,
  MCP_OAUTH_SCOPES,
  hasMcpOAuthScope,
  normalizeOAuthScope,
  scopeList,
  signMcpOAuthAccessToken,
  verifyMcpOAuthAccessToken,
} from "./oauth-token.js";

const ORIGINAL_ENV = { ...process.env };
const ISSUER = "https://mail.example.com";
const RESOURCE = "https://mail.example.com/_agent-native/mcp";

const baseSign = {
  ownerEmail: "owner@example.com",
  clientId: "client-abc",
  scope: "mcp:read mcp:write",
  resource: RESOURCE,
  issuer: ISSUER,
};

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.A2A_SECRET;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe("normalizeOAuthScope", () => {
  it("returns the full default scope for empty / non-string input", () => {
    expect(normalizeOAuthScope("")).toBe(MCP_OAUTH_DEFAULT_SCOPE);
    expect(normalizeOAuthScope("   ")).toBe(MCP_OAUTH_DEFAULT_SCOPE);
    expect(normalizeOAuthScope(undefined)).toBe(MCP_OAUTH_DEFAULT_SCOPE);
    expect(normalizeOAuthScope(null)).toBe(MCP_OAUTH_DEFAULT_SCOPE);
    expect(normalizeOAuthScope(123)).toBe(MCP_OAUTH_DEFAULT_SCOPE);
  });

  it("keeps only allow-listed scopes and dedupes them", () => {
    expect(normalizeOAuthScope("mcp:read mcp:read mcp:write")).toBe(
      "mcp:read mcp:write",
    );
    expect(normalizeOAuthScope("mcp:apps")).toBe("mcp:apps");
    expect(normalizeOAuthScope("mcp:read offline_access")).toBe(
      "mcp:read offline_access",
    );
  });

  it("drops unknown scopes but keeps recognised ones", () => {
    expect(normalizeOAuthScope("mcp:read openid profile")).toBe("mcp:read");
  });

  it("returns null when every requested scope is unknown (request rejected)", () => {
    expect(normalizeOAuthScope("openid profile email")).toBeNull();
    expect(normalizeOAuthScope("admin:* mcp:admin")).toBeNull();
  });

  it("default scope includes MCP permissions and durable refresh access", () => {
    expect(MCP_OAUTH_DEFAULT_SCOPE.split(" ").sort()).toEqual(
      [...MCP_OAUTH_SCOPES].sort(),
    );
  });
});

describe("scopeList", () => {
  it("splits on arbitrary whitespace and trims, ignoring undefined", () => {
    expect(scopeList("mcp:read  mcp:write\tmcp:apps")).toEqual([
      "mcp:read",
      "mcp:write",
      "mcp:apps",
    ]);
    expect(scopeList(undefined)).toEqual([]);
    expect(scopeList("")).toEqual([]);
  });
});

describe("hasMcpOAuthScope", () => {
  it("treats an undefined scope set as fully permissive (legacy tokens)", () => {
    expect(hasMcpOAuthScope(undefined, "mcp:write")).toBe(true);
  });

  it("grants only when the specific scope is present", () => {
    expect(hasMcpOAuthScope(["mcp:read"], "mcp:read")).toBe(true);
    expect(hasMcpOAuthScope(["mcp:read"], "mcp:write")).toBe(false);
    expect(hasMcpOAuthScope([], "mcp:read")).toBe(false);
  });
});

describe("signMcpOAuthAccessToken + verifyMcpOAuthAccessToken round-trip", () => {
  it("verifies a freshly minted token and returns the bound identity & scopes", async () => {
    const token = await signMcpOAuthAccessToken({
      ...baseSign,
      orgId: "org-1",
      orgDomain: "example.com",
    });
    const result = await verifyMcpOAuthAccessToken(token, RESOURCE);
    expect(result).toMatchObject({
      userEmail: "owner@example.com",
      orgId: "org-1",
      orgDomain: "example.com",
      scopes: ["mcp:read", "mcp:write"],
      clientId: "client-abc",
    });
    expect(typeof result?.jti).toBe("string");
  });

  it("omits org claims entirely when not provided", async () => {
    const token = await signMcpOAuthAccessToken(baseSign);
    const decoded = jose.decodeJwt(token);
    expect(decoded.org_id).toBeUndefined();
    expect(decoded.org_domain).toBeUndefined();
    const result = await verifyMcpOAuthAccessToken(token, RESOURCE);
    expect(result?.orgId).toBeUndefined();
    expect(result?.orgDomain).toBeUndefined();
  });

  it("sets the typ marker, issuer, audience, jti, and an expiry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const token = await signMcpOAuthAccessToken(baseSign);
    const decoded = jose.decodeJwt(token) as any;
    expect(decoded.typ).toBe("agent-native-mcp-oauth");
    expect(decoded.iss).toBe(ISSUER);
    expect(decoded.aud).toBe(RESOURCE);
    expect(typeof decoded.jti).toBe("string");
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  it("uses a provided jti when supplied", async () => {
    const token = await signMcpOAuthAccessToken({
      ...baseSign,
      jti: "connect-jti-123",
    });
    const decoded = jose.decodeJwt(token) as any;
    expect(decoded.jti).toBe("connect-jti-123");
    const result = await verifyMcpOAuthAccessToken(token, RESOURCE);
    expect(result?.jti).toBe("connect-jti-123");
  });

  it("uses a provided expiry when supplied", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const token = await signMcpOAuthAccessToken({
      ...baseSign,
      expiresIn: "30d",
    });
    const decoded = jose.decodeJwt(token) as any;
    const lifetimeDays = (decoded.exp - decoded.iat) / 86400;
    expect(Math.round(lifetimeDays)).toBe(30);
  });

  it("prefers A2A_SECRET over the better-auth secret for signing+verify", async () => {
    process.env.A2A_SECRET = "a2a-strong-secret";
    const token = await signMcpOAuthAccessToken(baseSign);
    // Verifies with the same A2A_SECRET active.
    expect(await verifyMcpOAuthAccessToken(token, RESOURCE)).not.toBeNull();
    // A token signed under A2A_SECRET must fail once the secret changes.
    delete process.env.A2A_SECRET;
    expect(await verifyMcpOAuthAccessToken(token, RESOURCE)).toBeNull();
  });

  it("ignores whitespace-only A2A_SECRET and falls back to the auth secret", async () => {
    process.env.A2A_SECRET = "   ";
    const token = await signMcpOAuthAccessToken(baseSign);

    expect(await verifyMcpOAuthAccessToken(token, RESOURCE)).not.toBeNull();
    await expect(
      jose.jwtVerify(token, new TextEncoder().encode("   "), {
        audience: RESOURCE,
      }),
    ).rejects.toThrow();
    await expect(
      jose.jwtVerify(token, new TextEncoder().encode("fallback-auth-secret"), {
        audience: RESOURCE,
      }),
    ).resolves.toBeTruthy();
  });
});

describe("verifyMcpOAuthAccessToken — audience array (host-drift tolerance)", () => {
  it("verifies when the token audience is the second entry in the array", async () => {
    const ALT_RESOURCE = "https://plan.agent-native.com/_agent-native/mcp";
    const token = await signMcpOAuthAccessToken({
      ...baseSign,
      resource: ALT_RESOURCE,
      issuer: "https://plan.agent-native.com",
    });
    // Token was minted for ALT_RESOURCE; request now arrives via RESOURCE.
    // Passing both as an array must accept the token.
    const result = await verifyMcpOAuthAccessToken(token, [
      RESOURCE,
      ALT_RESOURCE,
    ]);
    expect(result).not.toBeNull();
    expect(result?.userEmail).toBe("owner@example.com");
  });

  it("verifies when the request-derived resource is the minted audience", async () => {
    const token = await signMcpOAuthAccessToken(baseSign);
    // Primary resource is RESOURCE; alt is something else entirely.
    const result = await verifyMcpOAuthAccessToken(token, [
      RESOURCE,
      "https://other.agent-native.com/_agent-native/mcp",
    ]);
    expect(result).not.toBeNull();
  });

  it("normalises trailing slashes when comparing resource claims", async () => {
    const token = await signMcpOAuthAccessToken(baseSign);
    // Add a trailing slash — must still match.
    const result = await verifyMcpOAuthAccessToken(token, [`${RESOURCE}/`]);
    expect(result).not.toBeNull();
  });

  it("returns null when audience array has no matching entry", async () => {
    const token = await signMcpOAuthAccessToken(baseSign);
    const result = await verifyMcpOAuthAccessToken(token, [
      "https://wrong.example.com/_agent-native/mcp",
      "https://also-wrong.example.com/_agent-native/mcp",
    ]);
    expect(result).toBeNull();
  });
});

describe("verifyMcpOAuthAccessToken — secret rotation tolerance", () => {
  it("verifies a token signed with A2A_SECRET when A2A_SECRET is later removed (fallback to auth secret would fail, but secret-with-A2A was primary)", async () => {
    // This assertion remains: removing A2A_SECRET means only fallback is tried.
    // A token signed under a *different* A2A_SECRET is rejected.
    process.env.A2A_SECRET = "unique-a2a-secret";
    const token = await signMcpOAuthAccessToken(baseSign);
    delete process.env.A2A_SECRET;
    // "fallback-auth-secret" != "unique-a2a-secret" → still rejected.
    expect(await verifyMcpOAuthAccessToken(token, RESOURCE)).toBeNull();
  });

  it("verifies a token signed with fallback-auth-secret after A2A_SECRET is later added", async () => {
    // Token minted without A2A_SECRET (uses fallback-auth-secret).
    delete process.env.A2A_SECRET;
    const token = await signMcpOAuthAccessToken(baseSign);
    // Now A2A_SECRET is added to the deploy — the old token (signed with
    // fallback) must still be accepted because we try both secrets.
    process.env.A2A_SECRET = "newly-added-a2a-secret";
    const result = await verifyMcpOAuthAccessToken(token, RESOURCE);
    expect(result).not.toBeNull();
    expect(result?.userEmail).toBe("owner@example.com");
  });

  it("does NOT fall through to next secret for expired tokens (expiry is definitive)", async () => {
    delete process.env.A2A_SECRET;
    const token = await new jose.SignJWT({
      typ: "agent-native-mcp-oauth",
      sub: "owner@example.com",
      scope: "mcp:read",
      client_id: "client-abc",
      resource: RESOURCE,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(RESOURCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode("fallback-auth-secret"));
    // Expired under the correct secret — must still be rejected.
    expect(await verifyMcpOAuthAccessToken(token, RESOURCE)).toBeNull();
  });
});

describe("MCP_OAUTH_ACCESS_TOKEN_TTL default and env override", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("default TTL is 30d (2592000 seconds)", () => {
    expect(MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(30 * 86400);
  });

  it("minted token with default TTL has ~30d lifetime", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const token = await signMcpOAuthAccessToken(baseSign);
    const decoded = jose.decodeJwt(token) as any;
    const lifetimeDays = (decoded.exp - decoded.iat) / 86400;
    expect(Math.round(lifetimeDays)).toBe(30);
  });
});

describe("verifyMcpOAuthAccessToken rejection branches", () => {
  it("returns null when no resource is supplied (audience cannot be checked)", async () => {
    const token = await signMcpOAuthAccessToken(baseSign);
    expect(await verifyMcpOAuthAccessToken(token, undefined)).toBeNull();
  });

  it("rejects a token whose audience differs from the requested resource", async () => {
    const token = await signMcpOAuthAccessToken(baseSign);
    expect(
      await verifyMcpOAuthAccessToken(token, "https://other.example.com/mcp"),
    ).toBeNull();
  });

  it("rejects a token signed with the wrong secret", async () => {
    const wrong = await new jose.SignJWT({
      typ: "agent-native-mcp-oauth",
      sub: "owner@example.com",
      scope: "mcp:read",
      client_id: "client-abc",
      resource: RESOURCE,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISSUER)
      .setAudience(RESOURCE)
      .setExpirationTime("1h")
      .setIssuedAt()
      .sign(new TextEncoder().encode("attacker-secret"));
    expect(await verifyMcpOAuthAccessToken(wrong, RESOURCE)).toBeNull();
  });

  it("rejects a token with the wrong typ marker (not an MCP OAuth token)", async () => {
    const token = await new jose.SignJWT({
      typ: "some-other-token",
      sub: "owner@example.com",
      scope: "mcp:read",
      client_id: "client-abc",
      resource: RESOURCE,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(RESOURCE)
      .setExpirationTime("1h")
      .setIssuedAt()
      .sign(new TextEncoder().encode("fallback-auth-secret"));
    expect(await verifyMcpOAuthAccessToken(token, RESOURCE)).toBeNull();
  });

  it("rejects a token whose embedded resource claim mismatches the audience", async () => {
    // aud matches the requested resource (so jose passes), but the inner
    // `resource` claim was forged to a different value — must be rejected.
    const token = await new jose.SignJWT({
      typ: "agent-native-mcp-oauth",
      sub: "owner@example.com",
      scope: "mcp:read",
      client_id: "client-abc",
      resource: "https://evil.example.com/mcp",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(RESOURCE)
      .setExpirationTime("1h")
      .setIssuedAt()
      .sign(new TextEncoder().encode("fallback-auth-secret"));
    expect(await verifyMcpOAuthAccessToken(token, RESOURCE)).toBeNull();
  });

  it("rejects a token missing a subject", async () => {
    const token = await new jose.SignJWT({
      typ: "agent-native-mcp-oauth",
      scope: "mcp:read",
      client_id: "client-abc",
      resource: RESOURCE,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(RESOURCE)
      .setExpirationTime("1h")
      .setIssuedAt()
      .sign(new TextEncoder().encode("fallback-auth-secret"));
    expect(await verifyMcpOAuthAccessToken(token, RESOURCE)).toBeNull();
  });

  it("rejects a token missing a client_id", async () => {
    const token = await new jose.SignJWT({
      typ: "agent-native-mcp-oauth",
      sub: "owner@example.com",
      scope: "mcp:read",
      resource: RESOURCE,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(RESOURCE)
      .setExpirationTime("1h")
      .setIssuedAt()
      .sign(new TextEncoder().encode("fallback-auth-secret"));
    expect(await verifyMcpOAuthAccessToken(token, RESOURCE)).toBeNull();
  });

  it("rejects a token carrying no recognised MCP scope", async () => {
    const token = await new jose.SignJWT({
      typ: "agent-native-mcp-oauth",
      sub: "owner@example.com",
      scope: "openid profile",
      client_id: "client-abc",
      resource: RESOURCE,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(RESOURCE)
      .setExpirationTime("1h")
      .setIssuedAt()
      .sign(new TextEncoder().encode("fallback-auth-secret"));
    expect(await verifyMcpOAuthAccessToken(token, RESOURCE)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await new jose.SignJWT({
      typ: "agent-native-mcp-oauth",
      sub: "owner@example.com",
      scope: "mcp:read",
      client_id: "client-abc",
      resource: RESOURCE,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(RESOURCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode("fallback-auth-secret"));
    expect(await verifyMcpOAuthAccessToken(token, RESOURCE)).toBeNull();
  });

  it("rejects a structurally invalid token string", async () => {
    expect(await verifyMcpOAuthAccessToken("not-a-jwt", RESOURCE)).toBeNull();
  });
});
