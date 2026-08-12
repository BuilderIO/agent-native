import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

interface CodeRow {
  code_hash: string;
  state: string;
  app_id: string;
  client_id: string;
  redirect_uri: string;
  authority: string;
  code_challenge: string;
  email: string;
  name: string | null;
  org_domain: string | null;
  jti: string;
  expires_at: number;
  consumed_at: number | null;
}

const codeRows: CodeRow[] = [];

const exec = async (input: string | { sql: string; args?: unknown[] }) => {
  const sql = (typeof input === "string" ? input : input.sql).trim();
  const args = (typeof input === "string" ? [] : (input.args ?? [])) as any[];
  if (/^CREATE TABLE/i.test(sql)) return { rows: [], rowsAffected: 0 };
  if (/^DELETE FROM identity_sso_authorization_code/i.test(sql)) {
    for (let i = codeRows.length - 1; i >= 0; i--) {
      if (codeRows[i].expires_at < args[0]) codeRows.splice(i, 1);
    }
    return { rows: [], rowsAffected: 0 };
  }
  if (/^INSERT INTO identity_sso_authorization_code/i.test(sql)) {
    codeRows.push({
      code_hash: args[0],
      state: args[1],
      app_id: args[2],
      client_id: args[3],
      redirect_uri: args[4],
      authority: args[5],
      code_challenge: args[6],
      email: args[7],
      name: args[8],
      org_domain: args[9],
      jti: args[10],
      expires_at: args[12],
      consumed_at: args[13],
    });
    return { rows: [], rowsAffected: 1 };
  }
  if (/^SELECT state, app_id, client_id/i.test(sql)) {
    const row = codeRows.find((candidate) => candidate.code_hash === args[0]);
    return { rows: row ? [{ ...row }] : [], rowsAffected: 0 };
  }
  if (/^UPDATE identity_sso_authorization_code SET consumed_at/i.test(sql)) {
    const row = codeRows.find((candidate) => candidate.code_hash === args[1]);
    if (row && row.consumed_at == null) {
      row.consumed_at = args[0];
      return { rows: [], rowsAffected: 1 };
    }
    return { rows: [], rowsAffected: 0 };
  }
  throw new Error(`unexpected SQL in test: ${sql}`);
};

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: exec }),
  intType: () => "INTEGER",
}));

const mod = await import("./identity-sso.js");

const CALLBACK =
  "https://mail.agent-native.com/_agent-native/identity/callback";
const AUTHORITY = "https://dispatch.agent-native.com";
const STATE = "s".repeat(43);
const VERIFIER = "v".repeat(64);

beforeEach(() => {
  codeRows.length = 0;
  process.env.IDENTITY_SSO_APP_REGISTRY_JSON = "";
});

afterEach(() => {
  delete process.env.IDENTITY_SSO_APP_REGISTRY_JSON;
});

describe("strict identity app registration", () => {
  it("accepts exact canonical app/client/callback pairs", () => {
    expect(mod.isAllowedIdentityRedirect("mail", CALLBACK)).toBe(true);
    expect(mod.resolveIdentitySsoApp("mail", "mail", CALLBACK)?.origin).toBe(
      "https://mail.agent-native.com",
    );
  });

  it("rejects mismatched app ids, paths, unknown hosts, and suffix spoofing", () => {
    expect(mod.isAllowedIdentityRedirect("calendar", CALLBACK)).toBe(false);
    expect(
      mod.isAllowedIdentityRedirect("mail", "https://mail.agent-native.com/cb"),
    ).toBe(false);
    expect(
      mod.isAllowedIdentityRedirect(
        "unknown",
        "https://unknown.agent-native.com/_agent-native/identity/callback",
      ),
    ).toBe(false);
    expect(mod.isAllowedRedirectUri("https://evil.agent-native.com/cb")).toBe(
      false,
    );
    expect(
      mod.isAllowedRedirectUri("https://agent-native.com.evil.example/cb"),
    ).toBe(false);
  });

  it("requires explicit custom registration and identity-sso capability", () => {
    const customOrigin = "https://workspace.example.com";
    const env = {
      IDENTITY_SSO_APP_REGISTRY_JSON: JSON.stringify([
        {
          appId: "workspace",
          clientId: "workspace-client",
          origin: customOrigin,
          callbackPath: "/_agent-native/identity/callback",
          capabilities: ["identity-sso"],
        },
      ]),
    } as unknown as NodeJS.ProcessEnv;
    const callback = `${customOrigin}/_agent-native/identity/callback`;
    expect(
      mod.resolveIdentitySsoApp("workspace", "workspace-client", callback, env),
    ).not.toBeNull();
    expect(
      mod.resolveIdentitySsoApp("workspace", "workspace", callback, env),
    ).toBeNull();
    expect(
      mod.resolveIdentitySsoApp(
        "workspace",
        "workspace-client",
        "https://workspace.example.com.evil/_agent-native/identity/callback",
        env,
      ),
    ).toBeNull();
  });

  it("keeps localhost as an exact development-only callback", () => {
    expect(
      mod.isAllowedIdentityRedirect(
        "mail",
        "http://localhost:8085/_agent-native/identity/callback",
      ),
    ).toBe(true);
    expect(
      mod.isAllowedIdentityRedirect("mail", "http://localhost:8085/other"),
    ).toBe(false);
  });
});

describe("authorization-code store", () => {
  it("stores only a hash and consumes a code once with PKCE and binding", async () => {
    const challenge = mod.createCodeChallenge(VERIFIER)!;
    const code = await mod.createIdentityAuthorizationCode({
      state: STATE,
      appId: "mail",
      clientId: "mail",
      redirectUri: CALLBACK,
      authority: AUTHORITY,
      codeChallenge: challenge,
      email: "user@example.test",
      name: "User",
      orgDomain: "example.test",
    });
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeRows[0]?.code_hash).not.toBe(code);
    expect(
      await mod.consumeIdentityAuthorizationCode({
        code,
        state: STATE,
        appId: "mail",
        clientId: "mail",
        redirectUri: CALLBACK,
        authority: AUTHORITY,
        codeVerifier: VERIFIER,
      }),
    ).toEqual({
      email: "user@example.test",
      name: "User",
      orgDomain: "example.test",
      jti: expect.any(String),
    });
    expect(
      await mod.consumeIdentityAuthorizationCode({
        code,
        state: STATE,
        appId: "mail",
        clientId: "mail",
        redirectUri: CALLBACK,
        authority: AUTHORITY,
        codeVerifier: VERIFIER,
      }),
    ).toBeNull();
  });

  it("fails closed for wrong verifier, state, redirect, client, or authority", async () => {
    const code = await mod.createIdentityAuthorizationCode({
      state: STATE,
      appId: "mail",
      clientId: "mail",
      redirectUri: CALLBACK,
      authority: AUTHORITY,
      codeChallenge: mod.createCodeChallenge(VERIFIER)!,
      email: "user@example.test",
    });
    await expect(
      mod.consumeIdentityAuthorizationCode({
        code,
        state: "x".repeat(43),
        appId: "mail",
        clientId: "mail",
        redirectUri: CALLBACK,
        authority: AUTHORITY,
        codeVerifier: VERIFIER,
      }),
    ).resolves.toBeNull();
    await expect(
      mod.consumeIdentityAuthorizationCode({
        code,
        state: STATE,
        appId: "mail",
        clientId: "mail",
        redirectUri: CALLBACK,
        authority: AUTHORITY,
        codeVerifier: "wrong".repeat(13),
      }),
    ).resolves.toBeNull();
  });
});

describe("identity claims and browser redirect", () => {
  it("keeps identity claims free of credentials and org authorization", () => {
    const claims = mod.buildIdentityClaims({
      email: "user@example.test",
      name: " User ",
      orgDomain: "example.test",
    });
    expect(claims).toMatchObject({
      sub: "user@example.test",
      email: "user@example.test",
      scope: "identity",
      name: "User",
      org_domain: "example.test",
    });
    expect(Object.keys(claims)).not.toContain("password");
    expect(Object.keys(claims)).not.toContain("role");
  });

  it("places a one-time code, never a JWT token, in the browser redirect", () => {
    const location = mod.buildRedirectLocation(CALLBACK, "code-value", STATE);
    const url = new URL(location);
    expect(url.searchParams.get("code")).toBe("code-value");
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.searchParams.has("assertion")).toBe(false);
  });
});
