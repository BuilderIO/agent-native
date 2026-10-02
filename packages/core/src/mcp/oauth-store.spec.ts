import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
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
      const result = await pglite.query(rawSql, args);
      return {
        rows: Array.from(result.rows ?? []) as any[],
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
  };
}

let exec = makeExec();

vi.mock("../db/client.js", () => ({
  getDbExec: () => exec,
  isConnectionError: (err: any) => err?.message === "CONNECTION_LOST",
  isProductionServerlessFunctionRuntime: () => false,
}));

beforeEach(async () => {
  pglite = await createTestPglite();
  connectionErrorNext = false;
  genericErrorNext = false;
  exec = makeExec();
});

afterEach(async () => {
  await pglite.close();
  vi.restoreAllMocks();
});

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

describe("OAuth issuance-owner schema migration", () => {
  it("adds nullable bindings without assigning ambiguous legacy grants to their current owners", async () => {
    await pglite.exec(`
      CREATE TABLE mcp_oauth_codes (
        code TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        org_domain TEXT,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        created_at BIGINT,
        expires_at BIGINT,
        consumed_at BIGINT
      );
      CREATE TABLE mcp_oauth_refresh_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        client_id TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        org_domain TEXT,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        created_at BIGINT,
        expires_at BIGINT,
        last_used_at BIGINT,
        revoked_at BIGINT,
        replaced_by_hash TEXT
      )
    `);
    const s = await freshStore();
    const expiresAt = Date.now() + 60_000;
    await pglite.query(
      `INSERT INTO mcp_oauth_codes (code, client_id, redirect_uri, code_challenge, code_challenge_method, owner_email, scope, resource, expires_at)
       VALUES ('synthetic-legacy-code', 'client-1', 'https://app.example.test/cb', 'synthetic-challenge', 'S256', 'successor@example.test', 'mcp:read', 'https://app.example.test/mcp', $1)`,
      [expiresAt],
    );
    await pglite.query(
      `INSERT INTO mcp_oauth_refresh_tokens (id, token_hash, client_id, owner_email, scope, resource, expires_at)
       VALUES ('synthetic-legacy-row', $1, 'client-1', 'successor@example.test', 'mcp:read', 'https://app.example.test/mcp', $2)`,
      [s.hashOAuthToken("synthetic-legacy-refresh"), expiresAt],
    );

    await s.ensureTable();

    for (const tableName of ["mcp_oauth_codes", "mcp_oauth_refresh_tokens"]) {
      expect(
        (await pglite.query(`SELECT issued_for_email FROM ${tableName}`)).rows,
      ).toEqual([{ issued_for_email: null }]);
    }
    expect(await s.getOAuthCode("synthetic-legacy-code")).toBeNull();
    expect(await s.getOAuthRefreshToken("synthetic-legacy-refresh")).toBeNull();
  });
});

describe("OAuth issuance executor", () => {
  const issuanceParams = {
    clientId: "synthetic-client",
    redirectUri: "https://app.example.test/callback",
    codeChallenge: "synthetic-challenge",
    codeChallengeMethod: "S256",
    ownerEmail: "owner@example.test",
    orgId: "synthetic-org",
    scope: "mcp:read",
    resource: "https://app.example.test/mcp",
  };

  it.each([0, undefined])(
    "rejects issuance when insertion reports %j affected rows",
    async (rowsAffected) => {
      const store = await freshStore();
      const tx = {
        execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected }),
      };
      await expect(store.createOAuthCode(issuanceParams, tx)).rejects.toThrow(
        "Authorization-code creation returned an invalid row count",
      );
      await expect(
        store.createOAuthRefreshToken(
          { ...issuanceParams, refreshToken: "synthetic-refresh" },
          tx,
        ),
      ).rejects.toThrow("Refresh-token creation returned an invalid row count");
      expect(tx.execute).toHaveBeenCalledTimes(2);
      expect(
        tx.execute.mock.calls.every(([input]) =>
          input.sql.startsWith("INSERT INTO "),
        ),
      ).toBe(true);
    },
  );

  it.each([0, undefined])(
    "rolls rotation back when successor insertion reports %j affected rows",
    async (rowsAffected) => {
      const store = await freshStore();
      const original = await store.createOAuthRefreshToken({
        ...issuanceParams,
        refreshToken: "synthetic-refresh",
      });
      await expect(
        pglite.db.transaction(async (transaction) => {
          const tx: DbExec = {
            async execute(input) {
              const sql = typeof input === "string" ? input : input.sql;
              if (sql.startsWith("INSERT INTO "))
                return { rows: [], rowsAffected: rowsAffected as number };
              const args = typeof input === "string" ? [] : (input.args ?? []);
              let index = 0;
              const result = await transaction.query(
                sql.replace(/\?/g, () => `$${++index}`),
                args,
              );
              return {
                rows: result.rows as Record<string, unknown>[],
                rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
              };
            },
          };
          return store.rotateOAuthRefreshToken(
            {
              oldRefreshToken: "synthetic-refresh",
              newRefreshToken: "synthetic-next-refresh",
            },
            tx,
          );
        }),
      ).rejects.toThrow("Refresh-token rotation returned an invalid row count");
      expect(await store.getOAuthRefreshToken("synthetic-refresh")).toEqual(
        original,
      );
      expect(
        await store.getOAuthRefreshToken("synthetic-next-refresh"),
      ).toBeNull();
    },
  );

  it("keeps every issuance and rotation statement on the supplied transaction without lazy DDL", async () => {
    const initialized = await freshStore();
    await initialized.ensureOAuthTables();
    const store = await freshStore();
    const globalExecute = vi.fn(async () => {
      throw new Error("Global database access during issuance");
    });
    exec = { execute: globalExecute };
    const params = {
      clientId: "synthetic-client",
      redirectUri: "https://app.example.test/callback",
      codeChallenge: "synthetic-challenge",
      codeChallengeMethod: "S256",
      ownerEmail: "owner@example.test",
      orgId: "synthetic-org",
      scope: "mcp:read",
      resource: "https://app.example.test/mcp",
    };
    const statements: string[] = [];
    await pglite.db.transaction(async (transaction) => {
      const tx: DbExec = {
        async execute(input) {
          const sql = typeof input === "string" ? input : input.sql;
          const args = typeof input === "string" ? [] : (input.args ?? []);
          statements.push(sql);
          let index = 0;
          const result = await transaction.query(
            sql.replace(/\?/g, () => `$${++index}`),
            args,
          );
          return {
            rows: result.rows as Record<string, unknown>[],
            rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
          };
        },
      };
      const code = await store.createOAuthCode(params, tx);
      expect(
        await store.consumeOAuthCode(code.code, params.ownerEmail, tx),
      ).toMatchObject({
        ownerEmail: params.ownerEmail,
        issuedForEmail: params.ownerEmail,
      });
      await store.createOAuthRefreshToken(
        { ...params, refreshToken: "synthetic-refresh" },
        tx,
      );
      expect(
        await store.rotateOAuthRefreshToken(
          {
            oldRefreshToken: "synthetic-refresh",
            newRefreshToken: "synthetic-next-refresh",
          },
          tx,
        ),
      ).toMatchObject({ issuedForEmail: params.ownerEmail });
    });
    expect(globalExecute).not.toHaveBeenCalled();
    expect(statements).toHaveLength(7);
    expect(
      statements.every((sql) => /^(SELECT|INSERT|UPDATE) /.test(sql)),
    ).toBe(true);
    expect(
      (
        await pglite.query(
          "SELECT issued_for_email, revoked_at FROM mcp_oauth_refresh_tokens ORDER BY revoked_at NULLS FIRST",
        )
      ).rows,
    ).toEqual([
      { issued_for_email: params.ownerEmail, revoked_at: null },
      { issued_for_email: params.ownerEmail, revoked_at: expect.any(Number) },
    ]);
  });
});

describe("client registration", () => {
  it("infers native application type for a pre-migration loopback client", async () => {
    await pglite.exec(`
      CREATE TABLE mcp_oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_name TEXT,
        redirect_uris TEXT NOT NULL,
        grant_types TEXT,
        response_types TEXT,
        token_endpoint_auth_method TEXT,
        created_at BIGINT
      );
      INSERT INTO mcp_oauth_clients (
        client_id,
        client_name,
        redirect_uris,
        grant_types,
        response_types,
        token_endpoint_auth_method,
        created_at
      ) VALUES (
        'legacy-native',
        'Legacy native client',
        '["http://localhost/callback"]',
        '["authorization_code"]',
        '["code"]',
        'none',
        1700000000000
      );
    `);
    const s = await freshStore();

    await expect(s.getOAuthClient("legacy-native")).resolves.toMatchObject({
      clientId: "legacy-native",
      applicationType: "native",
      redirectUris: ["http://localhost/callback"],
    });
  });

  it("round-trips a registered client and applies grant/response defaults", async () => {
    const s = await freshStore();
    const reg = await s.registerOAuthClient({
      clientName: "Claude",
      redirectUris: ["https://claude.ai/cb"],
      applicationType: "native",
    });
    expect(reg.clientId).toMatch(/^agent-native-oauth-client-/);
    expect(reg.grantTypes).toEqual(["authorization_code", "refresh_token"]);
    expect(reg.responseTypes).toEqual(["code"]);
    expect(reg.tokenEndpointAuthMethod).toBe("none");
    expect(reg.applicationType).toBe("native");

    const fetched = await s.getOAuthClient(reg.clientId);
    expect(fetched).toMatchObject({
      clientId: reg.clientId,
      clientName: "Claude",
      redirectUris: ["https://claude.ai/cb"],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
      applicationType: "native",
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
    vi.spyOn(Date, "now").mockReturnValue(0);
    await s.registerOAuthClient({ redirectUris: ["https://x/cb"] });
    vi.spyOn(Date, "now").mockReturnValue(10_000_000);
    for (let i = 0; i < s.MCP_OAUTH_REGISTER_MAX - 1; i++) {
      await s.registerOAuthClient({ redirectUris: ["https://x/cb"] });
    }
    await expect(
      s.registerOAuthClient({ redirectUris: ["https://x/cb"] }),
    ).resolves.toBeTruthy();
  });

  it("getOAuthClient swallows connection errors and returns null", async () => {
    const s = await freshStore();
    await s.registerOAuthClient({ redirectUris: ["https://x/cb"] });
    connectionErrorNext = true;
    expect(await s.getOAuthClient("anything")).toBeNull();
  });

  it("getOAuthClient re-throws non-connection errors (no silent null)", async () => {
    const s = await freshStore();
    await s.registerOAuthClient({ redirectUris: ["https://x/cb"] });
    genericErrorNext = true;
    await expect(s.getOAuthClient("anything")).rejects.toThrow("SYNTAX_ERROR");
  });

  it("registration proceeds when the rate-limit count read fails transiently", async () => {
    const s = await freshStore();
    await s.registerOAuthClient({ redirectUris: ["https://seed/cb"] });
    connectionErrorNext = true;
    const reg = await s.registerOAuthClient({
      redirectUris: ["https://after-failure/cb"],
    });
    expect(reg.clientId).toMatch(/^agent-native-oauth-client-/);
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
      issuedForEmail: "owner@example.com",
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

  it.each([null, "", " ", "former@example.test"])(
    "refuses a code with issuance binding %j without consuming it",
    async (binding) => {
      const s = await freshStore();
      const created = await s.createOAuthCode(codeParams);
      await pglite.exec(
        "ALTER TABLE mcp_oauth_codes ADD COLUMN IF NOT EXISTS issued_for_email TEXT",
      );
      await pglite.query(
        "UPDATE mcp_oauth_codes SET issued_for_email = $1 WHERE code = $2",
        [binding, created.code],
      );

      expect(await s.getOAuthCode(created.code)).toBeNull();
      expect(await s.consumeOAuthCode(created.code)).toBeNull();
      expect(
        (await pglite.query("SELECT consumed_at FROM mcp_oauth_codes")).rows,
      ).toEqual([{ consumed_at: null }]);
    },
  );

  it("keeps a code valid when an intentional email rekey updates both owner fields", async () => {
    const s = await freshStore();
    const created = await s.createOAuthCode(codeParams);
    await pglite.query(
      "UPDATE mcp_oauth_codes SET owner_email = $1, issued_for_email = $1 WHERE code = $2",
      ["renamed@example.test", created.code],
    );

    expect(await s.getOAuthCode(created.code)).toMatchObject({
      ownerEmail: "renamed@example.test",
      issuedForEmail: "renamed@example.test",
    });
    expect(
      await s.consumeOAuthCode(created.code, "renamed@example.test"),
    ).toMatchObject({
      ownerEmail: "renamed@example.test",
      issuedForEmail: "renamed@example.test",
    });
  });

  it("refuses consumption when a code is rekeyed between its read and conditional update", async () => {
    const s = await freshStore();
    const created = await s.createOAuthCode(codeParams);
    const execute = exec.execute.bind(exec);
    vi.spyOn(exec, "execute").mockImplementation(async (input) => {
      if (
        typeof input !== "string" &&
        input.sql.startsWith("UPDATE mcp_oauth_codes SET consumed_at")
      ) {
        await pglite.query(
          "UPDATE mcp_oauth_codes SET owner_email = $1, issued_for_email = $1 WHERE code = $2",
          ["renamed@example.test", created.code],
        );
      }
      return execute(input);
    });

    expect(
      await s.consumeOAuthCode(created.code, codeParams.ownerEmail),
    ).toBeNull();
    expect(
      (await pglite.query("SELECT consumed_at FROM mcp_oauth_codes")).rows,
    ).toEqual([{ consumed_at: null }]);
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
    expect(await s.consumeOAuthCode(created.code)).toBeNull();
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
    const dump = (await pglite
      .prepare("SELECT * FROM mcp_oauth_refresh_tokens")
      .all()) as any[];
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
      issuedForEmail: "owner@example.com",
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

    await expect(
      s.touchOAuthRefreshToken("raw-refresh-token", refreshParams.ownerEmail),
    ).resolves.toBe("renewed");

    const found = await s.getOAuthRefreshToken("raw-refresh-token");
    expect(found).toMatchObject({
      tokenHash: s.hashOAuthToken("raw-refresh-token"),
      lastUsedAt: 2000,
      revokedAt: null,
    });
  });

  it("renews a refresh grant only on the supplied transaction executor", async () => {
    const s = await freshStore();
    await s.createOAuthRefreshToken(refreshParams);
    const tx: DbExec = { execute: vi.fn(exec.execute.bind(exec)) };
    const globalWrite = vi
      .spyOn(exec, "execute")
      .mockImplementation(async () => {
        throw new Error("renewal escaped its supplied transaction");
      });
    await expect(
      s.touchOAuthRefreshToken(
        "raw-refresh-token",
        refreshParams.ownerEmail,
        tx,
      ),
    ).resolves.toBe("renewed");
    expect(globalWrite).not.toHaveBeenCalled();
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(
      (await pglite.query("SELECT last_used_at FROM mcp_oauth_refresh_tokens"))
        .rows[0].last_used_at,
    ).not.toBeNull();
  });

  it("does not revoke a grant rekeyed away from the previously validated owner", async () => {
    const s = await freshStore();
    await s.createOAuthRefreshToken(refreshParams);
    await pglite.query(
      "UPDATE mcp_oauth_refresh_tokens SET owner_email = $1, issued_for_email = $1",
      ["renamed@example.test"],
    );
    await s.revokeOAuthRefreshToken(
      "raw-refresh-token",
      refreshParams.ownerEmail,
    );
    expect(await s.getOAuthRefreshToken("raw-refresh-token")).toMatchObject({
      ownerEmail: "renamed@example.test",
      issuedForEmail: "renamed@example.test",
      revokedAt: null,
    });
  });

  it.each([NaN, -1, 2])(
    "rejects indeterminate revocation result %j instead of reporting cleanup success",
    async (rowsAffected) => {
      const s = await freshStore();
      await s.createOAuthRefreshToken(refreshParams);
      vi.spyOn(exec, "execute").mockResolvedValueOnce({
        rows: [],
        rowsAffected,
      });
      await expect(
        s.revokeOAuthRefreshToken(
          "raw-refresh-token",
          refreshParams.ownerEmail,
        ),
      ).rejects.toThrow(/invalid row count/);
    },
  );

  it.each([null, "", " ", "former@example.test"])(
    "refuses refresh lookup, renewal, and rotation with issuance binding %j",
    async (binding) => {
      const s = await freshStore();
      await s.createOAuthRefreshToken(refreshParams);
      await pglite.exec(
        "ALTER TABLE mcp_oauth_refresh_tokens ADD COLUMN IF NOT EXISTS issued_for_email TEXT",
      );
      await pglite.query(
        "UPDATE mcp_oauth_refresh_tokens SET issued_for_email = $1",
        [binding],
      );

      expect(await s.getOAuthRefreshToken("raw-refresh-token")).toBeNull();
      await expect(
        s.touchOAuthRefreshToken("raw-refresh-token", refreshParams.ownerEmail),
      ).resolves.toBe("invalid");
      expect(
        await s.rotateOAuthRefreshToken({
          oldRefreshToken: "raw-refresh-token",
          newRefreshToken: "synthetic-rotated-refresh",
        }),
      ).toBeNull();
      expect(
        (
          await pglite.query(
            "SELECT issued_for_email, revoked_at, last_used_at FROM mcp_oauth_refresh_tokens",
          )
        ).rows,
      ).toEqual([
        { issued_for_email: binding, revoked_at: null, last_used_at: null },
      ]);
    },
  );

  it("preserves the renamed issuance owner when a valid refresh token rotates", async () => {
    const s = await freshStore();
    await s.createOAuthRefreshToken(refreshParams);
    await pglite.query(
      "UPDATE mcp_oauth_refresh_tokens SET owner_email = $1, issued_for_email = $1",
      ["renamed@example.test"],
    );
    await expect(
      s.touchOAuthRefreshToken("raw-refresh-token", "renamed@example.test"),
    ).resolves.toBe("renewed");

    expect(
      await s.rotateOAuthRefreshToken({
        oldRefreshToken: "raw-refresh-token",
        newRefreshToken: "synthetic-rotated-refresh",
      }),
    ).toMatchObject({
      ownerEmail: "renamed@example.test",
      issuedForEmail: "renamed@example.test",
    });
    expect(
      await s.getOAuthRefreshToken("synthetic-rotated-refresh"),
    ).toMatchObject({
      ownerEmail: "renamed@example.test",
      issuedForEmail: "renamed@example.test",
    });
  });

  it("refuses renewal after a rekey when the caller verified the previous owner", async () => {
    const s = await freshStore();
    await s.createOAuthRefreshToken(refreshParams);
    const verified = await s.getOAuthRefreshToken("raw-refresh-token");
    await pglite.query(
      "UPDATE mcp_oauth_refresh_tokens SET owner_email = $1, issued_for_email = $1",
      ["renamed@example.test"],
    );

    await expect(
      s.touchOAuthRefreshToken("raw-refresh-token", verified!.ownerEmail),
    ).resolves.toBe("invalid");
    expect(
      (await pglite.query("SELECT last_used_at FROM mcp_oauth_refresh_tokens"))
        .rows,
    ).toEqual([{ last_used_at: null }]);
  });

  it("refuses rotation when a token is rekeyed between its read and conditional update", async () => {
    const s = await freshStore();
    await s.createOAuthRefreshToken(refreshParams);
    const execute = exec.execute.bind(exec);
    vi.spyOn(exec, "execute").mockImplementation(async (input) => {
      if (
        typeof input !== "string" &&
        input.sql.startsWith("UPDATE mcp_oauth_refresh_tokens SET revoked_at")
      ) {
        await pglite.query(
          "UPDATE mcp_oauth_refresh_tokens SET owner_email = $1, issued_for_email = $1",
          ["renamed@example.test"],
        );
      }
      return execute(input);
    });

    expect(
      await s.rotateOAuthRefreshToken({
        oldRefreshToken: "raw-refresh-token",
        newRefreshToken: "synthetic-raced-rotation",
      }),
    ).toBeNull();
    expect(
      (
        await pglite.query(
          "SELECT revoked_at, replaced_by_hash FROM mcp_oauth_refresh_tokens",
        )
      ).rows,
    ).toEqual([{ revoked_at: null, replaced_by_hash: null }]);
    expect(await s.getOAuthRefreshToken("synthetic-raced-rotation")).toBeNull();
  });

  it("touchOAuthRefreshToken slides the expiry window (active users never expire)", async () => {
    const s = await freshStore();
    vi.spyOn(Date, "now").mockReturnValue(1000);
    await s.createOAuthRefreshToken(refreshParams);
    const original = await s.getOAuthRefreshToken("raw-refresh-token");
    expect(original?.expiresAt).toBe(1000 + s.MCP_OAUTH_REFRESH_TOKEN_TTL_MS);

    vi.spyOn(Date, "now").mockReturnValue(2000);
    await s.touchOAuthRefreshToken(
      "raw-refresh-token",
      refreshParams.ownerEmail,
    );
    const touched = await s.getOAuthRefreshToken("raw-refresh-token");
    expect(touched?.expiresAt).toBe(2000 + s.MCP_OAUTH_REFRESH_TOKEN_TTL_MS);
    expect(touched?.lastUsedAt).toBe(2000);
  });

  it.each(["revoked", "deleted"])(
    "reports invalid when renewal of a %s token updates zero rows",
    async (change) => {
      const s = await freshStore();
      await s.createOAuthRefreshToken(refreshParams);
      if (change === "revoked") {
        await s.revokeOAuthRefreshToken("raw-refresh-token");
      } else {
        await pglite.exec("DELETE FROM mcp_oauth_refresh_tokens");
      }
      const execute = vi.spyOn(exec, "execute");

      await expect(
        s.touchOAuthRefreshToken("raw-refresh-token", refreshParams.ownerEmail),
      ).resolves.toBe("invalid");
      await expect(execute.mock.results.at(-1)!.value).resolves.toMatchObject({
        rowsAffected: 0,
      });
      expect(await s.getOAuthRefreshToken("raw-refresh-token")).toBeNull();
    },
  );

  it("rejects unreadable renewal row counts instead of treating them as renewed", async () => {
    const s = await freshStore();
    await s.createOAuthRefreshToken(refreshParams);
    vi.spyOn(exec, "execute").mockResolvedValueOnce({
      rows: [],
      rowsAffected: NaN,
    });

    await expect(
      s.touchOAuthRefreshToken("raw-refresh-token", refreshParams.ownerEmail),
    ).rejects.toThrow(/invalid row count/);
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
    await expect(
      s.touchOAuthRefreshToken("raw-refresh-token", refreshParams.ownerEmail),
    ).resolves.toBe("invalid");
    expect(
      (await pglite.query("SELECT last_used_at FROM mcp_oauth_refresh_tokens"))
        .rows,
    ).toEqual([{ last_used_at: null }]);
  });

  it("rotateOAuthRefreshToken revokes the old token and issues a fresh one carrying the same identity", async () => {
    const s = await freshStore();
    const original = await s.createOAuthRefreshToken(refreshParams);
    const rotated = await s.rotateOAuthRefreshToken({
      oldRefreshToken: "raw-refresh-token",
      newRefreshToken: "new-refresh-token",
    });
    expect(rotated).not.toBeNull();
    expect(rotated).toMatchObject({
      clientId: "client-1",
      ownerEmail: "owner@example.com",
      issuedForEmail: "owner@example.com",
      orgId: "org-1",
      orgDomain: "example.com",
      scope: "mcp:read",
      resource: "https://mail.example.com",
      revokedAt: null,
    });
    expect(rotated?.tokenHash).toBe(s.hashOAuthToken("new-refresh-token"));
    expect(rotated?.id).not.toBe(original.id);

    expect(await s.getOAuthRefreshToken("raw-refresh-token")).toBeNull();
    expect(await s.getOAuthRefreshToken("new-refresh-token")).not.toBeNull();
  });

  it("records the replacement hash on the revoked old token (rotation chain)", async () => {
    const s = await freshStore();
    await s.createOAuthRefreshToken(refreshParams);
    await s.rotateOAuthRefreshToken({
      oldRefreshToken: "raw-refresh-token",
      newRefreshToken: "new-refresh-token",
    });
    const oldRow = (await pglite
      .prepare("SELECT * FROM mcp_oauth_refresh_tokens WHERE token_hash = ?")
      .get(s.hashOAuthToken("raw-refresh-token"))) as any;
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
    const count = (
      (await pglite
        .prepare("SELECT COUNT(*) AS n FROM mcp_oauth_refresh_tokens")
        .get()) as any
    ).n;
    expect(count).toBe(1);
  });
});
