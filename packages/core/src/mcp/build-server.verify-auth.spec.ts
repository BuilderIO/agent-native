import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jose from "jose";

// Stub the heavy MCP SDK + builtin-tools so importing build-server.ts is cheap
// — these specs only exercise verifyAuth's revoke-check addition.
vi.mock("./builtin-tools.js", () => ({ getBuiltinCrossAppTools: () => ({}) }));

const isJtiRevokedMock = vi.fn();
const touchTokenUsedMock = vi.fn(async () => {});
vi.mock("./connect-store.js", () => ({
  MCP_CONNECT_SCOPE: "mcp-connect",
  isJtiRevoked: (...a: any[]) => isJtiRevokedMock(...a),
  touchTokenUsed: (...a: any[]) => touchTokenUsedMock(...a),
}));

const { verifyAuth } = await import("./build-server.js");

const SECRET = "verify-auth-secret";
const enc = new TextEncoder().encode(SECRET);

async function sign(claims: Record<string, unknown>): Promise<string> {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(enc);
}

describe("verifyAuth — connect-token revoke check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.A2A_SECRET = SECRET;
    delete process.env.ACCESS_TOKEN;
    delete process.env.ACCESS_TOKENS;
  });
  afterEach(() => {
    delete process.env.A2A_SECRET;
  });

  it("does NOT query the revoke store for an ordinary A2A JWT (hot path untouched)", async () => {
    const token = await sign({ sub: "a@example.com" });
    const res = await verifyAuth(`Bearer ${token}`);
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("a@example.com");
    expect(isJtiRevokedMock).not.toHaveBeenCalled();
    expect(touchTokenUsedMock).not.toHaveBeenCalled();
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
    delete process.env.ACCESS_TOKEN;
    delete process.env.ACCESS_TOKENS;
  });
  afterEach(() => {
    delete process.env.A2A_SECRET;
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
});
