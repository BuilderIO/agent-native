import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * oauth-store persists OAuth clients, short-lived authorization codes, and
 * hashed refresh tokens for the standard remote MCP OAuth flow. We back it with
 * a REAL in-memory sqlite engine (wrapped to the framework's `DbExec` shape, the
 * same wrapper production uses for sqlite) so expiry filtering, consume-once
 * atomicity, UNIQUE constraints, and refresh rotation are exercised for real —
 * not pattern-matched. SQL stays dialect-agnostic; we never assert sqlite-only
 * behavior.
 */

let sqlite: Database.Database;
let connectionErrorNext = false;
let genericErrorNext = false;

function makeExec() {
  return {
    async execute(input: string | { sql: string; args?: unknown[] }) {
      if (connectionErrorNext) {
        connectionErrorNext = false;
        throw new Error("CONNECTION_LOST");
      }
      if (genericErrorNext) {
        genericErrorNext = false;
        throw new Error("SYNTAX_ERROR");
      }
      const rawSql = typeof input === "string" ? input : input.sql;
      const args = (
        typeof input === "string" ? [] : (input.args ?? [])
      ) as any[];
      const stmt = sqlite.prepare(rawSql);
      if (stmt.reader) {
        return { rows: stmt.all(...args) as any[], rowsAffected: 0 };
      }
      const result = stmt.run(...args);
      return { rows: [] as any[], rowsAffected: result.changes ?? 0 };
    },
  };
}

let exec = makeExec();

vi.mock("../db/client.js", () => ({
  getDbExec: () => exec,
  isConnectionError: (err: any) => err?.message === "CONNECTION_LOST",
  intType: () => "INTEGER",
}));

beforeEach(() => {
  sqlite = new Database(":memory:");
  connectionErrorNext = false;
  genericErrorNext = false;
  exec = makeExec();
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

// The store memoizes its CREATE TABLE init in a module-scoped `_initPromise`.
// Re-importing with a reset module graph each test rebinds that init to the
// current in-memory DB (there is no reset export), so tables are recreated in
// the fresh sqlite instance the test just opened.
async function freshStore() {
  vi.resetModules();
  return import("./oauth-store.js");
}

describe("oauth-store hashing & token generation", () => {
  it("generateOpaqueToken returns high-entropy, url-safe, distinct values", async () => {
    const s = await freshStore();
    const a = s.generateOpaqueToken();
    const b = s.generateOpaqueToken();
    expect(a).not.toBe(b);
    // 32 random bytes → 43-char base64url, no padding / non-url-safe chars.
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("hashOAuthToken is deterministic and not the identity of the token", async () => {
    const s = await freshStore();
    expect(s.hashOAuthToken("secret")).toBe(s.hashOAuthToken("secret"));
    expect(s.hashOAuthToken("secret")).not.toBe(s.hashOAuthToken("secret2"));
    expect(s.hashOAuthToken("secret")).not.toBe("secret");
    expect(s.hashOAuthToken("secret")).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("client registration", () => {
  it("round-trips a registered client and applies grant/response defaults", async () => {
    const s = await freshStore();
    const reg = await s.registerOAuthClient({
      clientName: "Claude",
      redirectUris: ["https://claude.ai/cb"],
    });
    expect(reg.clientId).toMatch(/^agent-native-oauth-client-/);
    expect(reg.grantTypes).toEqual(["authorization_code", "refresh_token"]);
    expect(reg.responseTypes).toEqual(["code"]);
    expect(reg.tokenEndpointAuthMethod).toBe("none");

    const fetched = await s.getOAuthClient(reg.clientId);
    expect(fetched).toMatchObject({
      clientId: reg.clientId,
      clientName: "Claude",
      redirectUris: ["https://claude.ai/cb"],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
    });
  });

  it("preserves caller-supplied grant/response types and auth method", async () => {
    const s = await freshStore();
    const reg = await s.registerOAuthClient({
      clientName: null,
      redirectUris: ["https://app/cb", "https://app/cb2"],
      grantTypes: ["authorization_code"],
      responseTypes: ["code", "token"],
      tokenEndpointAuthMethod: "client_secret_basic",
    });
    const fetched = await s.getOAuthClient(reg.clientId);
    expect(fetched?.grantTypes).toEqual(["authorization_code"]);
    expect(fetched?.responseTypes).toEqual(["code", "token"]);
    expect(fetched?.tokenEndpointAuthMethod).toBe("client_secret_basic");
    expect(fetched?.clientName).toBeNull();
    expect(fetched?.redirectUris).toEqual([
      "https://app/cb",
      "https://app/cb2",
    ]);
  });

  it("getOAuthClient returns null for an unknown client", async () => {
    const s = await freshStore();
    expect(await s.getOAuthClient("does-not-exist")).toBeNull();
  });

  it("enforces the registration rate limit inside the window", async () => {
    const s = await freshStore();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    for (let i = 0; i < s.MCP_OAUTH_REGISTER_MAX; i++) {
      await s.registerOAuthClient({ redirectUris: ["https://x/cb"] });
    }
    await expect(
      s.registerOAuthClient({ redirectUris: ["https://x/cb"] }),
    ).rejects.toThrow("RATE_LIMITED");
  });

  it("registrations outside the window do not count toward the limit", async () => {
    const s = await freshStore();
    // One ancient registration well before the window.
    vi.spyOn(Date, "now").mockReturnValue(0);
    await s.registerOAuthClient({ redirectUris: ["https://x/cb"] });
    // Move far past the window; fill up to MAX-1 fresh registrations.
    vi.spyOn(Date, "now").mockReturnValue(10_000_000);
    for (let i = 0; i < s.MCP_OAUTH_REGISTER_MAX - 1; i++) {
      await s.registerOAuthClient({ redirectUris: ["https://x/cb"] });
    }
    // The ancient one is outside the window, so one more must still succeed.
    await expect(
      s.registerOAuthClient({ redirectUris: ["https://x/cb"] }),
    ).resolves.toBeTruthy();
  });

  it("getOAuthClient swallows connection errors and returns null", async () => {
    const s = await freshStore();
    // Make sure the table exists first (so ensureTable in the call doesn't
    // need the DB), then fail the SELECT with a connection error.
    await s.registerOAuthClient({ redirectUris: ["https://x/cb"] });
    connectionErrorNext = true;
    expect(await s.getOAuthClient("anything")).toBeNull();
  });

  it("getOAuthClient re-throws non-connection errors (no silent null)", async () => {
    const s = await freshStore();
    // Table already initialized, so the next execute is the SELECT. A
    // non-connection failure must surface rather than be masked as "not found".
    await s.registerOAuthClient({ redirectUris: ["https://x/cb"] });
    genericErrorNext = true;
    await expect(s.getOAuthClient("anything")).rejects.toThrow("SYNTAX_ERROR");
  });

  it("registration proceeds when the rate-limit count read fails transiently", async () => {
    const s = await freshStore();
    // Table already initialized; the next execute is the COUNT(*) rate-limit
    // read. A transient connection failure there is swallowed (not RATE_LIMITED)
    // and the INSERT still proceeds, so the client is registered.
    await s.registerOAuthClient({ redirectUris: ["https://seed/cb"] });
    connectionErrorNext = true;
    const reg = await s.registerOAuthClient({
      redirectUris: ["https://after-failure/cb"],
    });
    expect(reg.clientId).toMatch(/^agent-native-oauth-client-/);
    // It was genuinely persisted, not just returned.
    expect(await s.getOAuthClient(reg.clientId)).toMatchObject({
      redirectUris: ["https://after-failure/cb"],
    });
  });
});

describe("authorization codes", () => {
  const codeParams = {
    clientId: "client-1",
    redirectUri: "https://claude.ai/cb",
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    orgDomain: "example.com",
    scope: "mcp:read mcp:write",
    resource: "https://mail.example.com",
  };

  it("creates a code with a 10-minute TTL and persists all claims", async () => {
    const s = await freshStore();
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const created = await s.createOAuthCode(codeParams);
    expect(created.expiresAt).toBe(1000 + s.MCP_OAUTH_CODE_TTL_MS);
    expect(created.consumedAt).toBeNull();

    const fetched = await s.getOAuthCode(created.code);
    expect(fetched).toMatchObject({
      clientId: "client-1",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      orgDomain: "example.com",
      scope: "mcp:read mcp:write",
      resource: "https://mail.example.com",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
    });
  });

  it("getOAuthCode returns null for an expired code", async () => {
    const s = await freshStore();
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const created = await s.createOAuthCode(codeParams);
    vi.spyOn(Date, "now").mockReturnValue(1000 + s.MCP_OAUTH_CODE_TTL_MS + 1);
    expect(await s.getOAuthCode(created.code)).toBeNull();
  });

  it("getOAuthCode returns null for an unknown code", async () => {
    const s = await freshStore();
    expect(await s.getOAuthCode("nope")).toBeNull();
  });

  it("consumeOAuthCode succeeds exactly once (single-use)", async () => {
    const s = await freshStore();
    const created = await s.createOAuthCode(codeParams);
    const first = await s.consumeOAuthCode(created.code);
    expect(first?.code).toBe(created.code);
    expect(first?.ownerEmail).toBe("owner@example.com");
    // A second consume returns null — the code is spent.
    expect(await s.consumeOAuthCode(created.code)).toBeNull();
    // And it is no longer readable.
    expect(await s.getOAuthCode(created.code)).toBeNull();
  });

  it("consumeOAuthCode returns null for an unknown or expired code", async () => {
    const s = await freshStore();
    expect(await s.consumeOAuthCode("missing")).toBeNull();

    vi.spyOn(Date, "now").mockReturnValue(1000);
    const created = await s.createOAuthCode(codeParams);
    vi.spyOn(Date, "now").mockReturnValue(1000 + s.MCP_OAUTH_CODE_TTL_MS + 1);
    expect(await s.consumeOAuthCode(created.code)).toBeNull();
  });

  it("defaults orgId / orgDomain to null when omitted", async () => {
    const s = await freshStore();
    const created = await s.createOAuthCode({
      ...codeParams,
      orgId: undefined,
      orgDomain: undefined,
    });
    expect(created.orgId).toBeNull();
    expect(created.orgDomain).toBeNull();
    const fetched = await s.getOAuthCode(created.code);
    expect(fetched?.orgId).toBeNull();
    expect(fetched?.orgDomain).toBeNull();
  });
});

describe("refresh tokens", () => {
  const refreshParams = {
    refreshToken: "raw-refresh-token",
    clientId: "client-1",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    orgDomain: "example.com",
    scope: "mcp:read",
    resource: "https://mail.example.com",
  };

  it("stores only the HASH of the refresh token, never the raw value", async () => {
    const s = await freshStore();
    const row = await s.createOAuthRefreshToken(refreshParams);
    expect(row.tokenHash).toBe(s.hashOAuthToken("raw-refresh-token"));
    expect(row.tokenHash).not.toBe("raw-refresh-token");
    // The raw value must not be retrievable from any stored column.
    const dump = sqlite
      .prepare("SELECT * FROM mcp_oauth_refresh_tokens")
      .all() as any[];
    const serialized = JSON.stringify(dump);
    expect(serialized).not.toContain("raw-refresh-token");
    expect(serialized).toContain(row.tokenHash);
  });

  it("looks up an active refresh token by its raw value", async () => {
    const s = await freshStore();
    await s.createOAuthRefreshToken(refreshParams);
    const found = await s.getOAuthRefreshToken("raw-refresh-token");
    expect(found).toMatchObject({
      clientId: "client-1",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      scope: "mcp:read",
      resource: "https://mail.example.com",
      revokedAt: null,
    });
    expect(await s.getOAuthRefreshToken("wrong-token")).toBeNull();
  });

  it("touchOAuthRefreshToken records refresh-token use without revoking it", async () => {
    const s = await freshStore();
    vi.spyOn(Date, "now").mockReturnValue(1000);
    await s.createOAuthRefreshToken(refreshParams);
    vi.spyOn(Date, "now").mockReturnValue(2000);

    await s.touchOAuthRefreshToken("raw-refresh-token");

    const found = await s.getOAuthRefreshToken("raw-refresh-token");
    expect(found).toMatchObject({
      tokenHash: s.hashOAuthToken("raw-refresh-token"),
      lastUsedAt: 2000,
      revokedAt: null,
    });
  });

  it("touchOAuthRefreshToken slides the expiry window (active users never expire)", async () => {
    const s = await freshStore();
    // Create at t=1000 — initial expiry is 1000 + TTL.
    vi.spyOn(Date, "now").mockReturnValue(1000);
    await s.createOAuthRefreshToken(refreshParams);
    const original = await s.getOAuthRefreshToken("raw-refresh-token");
    expect(original?.expiresAt).toBe(1000 + s.MCP_OAUTH_REFRESH_TOKEN_TTL_MS);

    // Touch at t=2000 — expiry must extend to 2000 + TTL.
    vi.spyOn(Date, "now").mockReturnValue(2000);
    await s.touchOAuthRefreshToken("raw-refresh-token");
    const touched = await s.getOAuthRefreshToken("raw-refresh-token");
    expect(touched?.expiresAt).toBe(2000 + s.MCP_OAUTH_REFRESH_TOKEN_TTL_MS);
    expect(touched?.lastUsedAt).toBe(2000);
  });

  it("refresh token TTL is 365d by default", async () => {
    const s = await freshStore();
    expect(s.MCP_OAUTH_REFRESH_TOKEN_TTL_MS).toBe(365 * 24 * 60 * 60_000);
  });

  it("getOAuthRefreshToken returns null once expired", async () => {
    const s = await freshStore();
    vi.spyOn(Date, "now").mockReturnValue(1000);
    await s.createOAuthRefreshToken(refreshParams);
    vi.spyOn(Date, "now").mockReturnValue(
      1000 + s.MCP_OAUTH_REFRESH_TOKEN_TTL_MS + 1,
    );
    expect(await s.getOAuthRefreshToken("raw-refresh-token")).toBeNull();
  });

  it("rotateOAuthRefreshToken revokes the old token and issues a fresh one carrying the same identity", async () => {
    const s = await freshStore();
    const original = await s.createOAuthRefreshToken(refreshParams);
    const rotated = await s.rotateOAuthRefreshToken({
      oldRefreshToken: "raw-refresh-token",
      newRefreshToken: "new-refresh-token",
    });
    expect(rotated).not.toBeNull();
    // The new token carries the original's identity/scope/resource.
    expect(rotated).toMatchObject({
      clientId: "client-1",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      orgDomain: "example.com",
      scope: "mcp:read",
      resource: "https://mail.example.com",
      revokedAt: null,
    });
    expect(rotated?.tokenHash).toBe(s.hashOAuthToken("new-refresh-token"));
    expect(rotated?.id).not.toBe(original.id);

    // The old token is revoked and no longer resolvable.
    expect(await s.getOAuthRefreshToken("raw-refresh-token")).toBeNull();
    // The new one is active.
    expect(await s.getOAuthRefreshToken("new-refresh-token")).not.toBeNull();
  });

  it("records the replacement hash on the revoked old token (rotation chain)", async () => {
    const s = await freshStore();
    await s.createOAuthRefreshToken(refreshParams);
    await s.rotateOAuthRefreshToken({
      oldRefreshToken: "raw-refresh-token",
      newRefreshToken: "new-refresh-token",
    });
    const oldRow = sqlite
      .prepare("SELECT * FROM mcp_oauth_refresh_tokens WHERE token_hash = ?")
      .get(s.hashOAuthToken("raw-refresh-token")) as any;
    expect(oldRow.revoked_at).not.toBeNull();
    expect(oldRow.replaced_by_hash).toBe(s.hashOAuthToken("new-refresh-token"));
  });

  it("rotation is single-use: reusing a spent refresh token yields null (reuse detection)", async () => {
    const s = await freshStore();
    await s.createOAuthRefreshToken(refreshParams);
    const first = await s.rotateOAuthRefreshToken({
      oldRefreshToken: "raw-refresh-token",
      newRefreshToken: "rotated-1",
    });
    expect(first).not.toBeNull();
    // Replaying the original (already revoked) token must not mint anything.
    const replay = await s.rotateOAuthRefreshToken({
      oldRefreshToken: "raw-refresh-token",
      newRefreshToken: "rotated-2",
    });
    expect(replay).toBeNull();
  });

  it("rotateOAuthRefreshToken returns null for an unknown token", async () => {
    const s = await freshStore();
    expect(
      await s.rotateOAuthRefreshToken({
        oldRefreshToken: "never-existed",
        newRefreshToken: "x",
      }),
    ).toBeNull();
  });

  it("rotateOAuthRefreshToken returns null for an expired token (no new token minted)", async () => {
    const s = await freshStore();
    vi.spyOn(Date, "now").mockReturnValue(1000);
    await s.createOAuthRefreshToken(refreshParams);
    vi.spyOn(Date, "now").mockReturnValue(
      1000 + s.MCP_OAUTH_REFRESH_TOKEN_TTL_MS + 1,
    );
    const rotated = await s.rotateOAuthRefreshToken({
      oldRefreshToken: "raw-refresh-token",
      newRefreshToken: "new-token",
    });
    expect(rotated).toBeNull();
    // No replacement row was inserted.
    const count = (
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM mcp_oauth_refresh_tokens")
        .get() as any
    ).n;
    expect(count).toBe(1);
  });
});
