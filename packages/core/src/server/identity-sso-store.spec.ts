import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FlowStateRow {
  state: string;
  return_path: string | null;
  app_id: string;
  client_id: string;
  redirect_uri: string;
  authority: string;
  code_challenge: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

const flowStates: FlowStateRow[] = [];
const jtis = new Set<string>();

const exec = async (input: string | { sql: string; args?: unknown[] }) => {
  const sql = (typeof input === "string" ? input : input.sql).trim();
  const args = (typeof input === "string" ? [] : (input.args ?? [])) as any[];

  if (/^CREATE TABLE/i.test(sql)) return { rows: [], rowsAffected: 0 };
  if (/^DELETE FROM identity_sso_flow_state/i.test(sql)) {
    const before = flowStates.length;
    for (let i = flowStates.length - 1; i >= 0; i--) {
      if (flowStates[i].expires_at < args[0]) flowStates.splice(i, 1);
    }
    return { rows: [], rowsAffected: before - flowStates.length };
  }
  if (/^DELETE FROM identity_sso_jti/i.test(sql)) {
    return { rows: [], rowsAffected: 0 };
  }
  if (/^SELECT COUNT\(\*\) AS n FROM identity_sso_flow_state/i.test(sql)) {
    return {
      rows: [
        {
          n: flowStates.filter((row) => row.created_at > args[0]).length,
        },
      ],
      rowsAffected: 0,
    };
  }
  if (/^INSERT INTO identity_sso_flow_state/i.test(sql)) {
    flowStates.push({
      state: args[0],
      return_path: args[1],
      app_id: args[2],
      client_id: args[3],
      redirect_uri: args[4],
      authority: args[5],
      code_challenge: args[6],
      created_at: args[7],
      expires_at: args[8],
      consumed_at: args[9],
    });
    return { rows: [], rowsAffected: 1 };
  }
  if (
    /^SELECT return_path, app_id, client_id, redirect_uri, authority, code_challenge, expires_at, consumed_at FROM identity_sso_flow_state/i.test(
      sql,
    )
  ) {
    const row = flowStates.find((candidate) => candidate.state === args[0]);
    return {
      rows: row ? [{ ...row }] : [],
      rowsAffected: 0,
    };
  }
  if (/^UPDATE identity_sso_flow_state SET consumed_at/i.test(sql)) {
    const row = flowStates.find((candidate) => candidate.state === args[1]);
    if (
      row &&
      row.consumed_at == null &&
      row.app_id === args[2] &&
      row.client_id === args[3] &&
      row.redirect_uri === args[4] &&
      row.authority === args[5] &&
      row.code_challenge === args[6]
    ) {
      row.consumed_at = args[0];
      return { rows: [], rowsAffected: 1 };
    }
    return { rows: [], rowsAffected: 0 };
  }
  if (/^INSERT INTO identity_sso_jti/i.test(sql)) {
    if (jtis.has(args[0])) {
      throw new Error("UNIQUE constraint failed: identity_sso_jti.jti");
    }
    jtis.add(args[0]);
    return { rows: [], rowsAffected: 1 };
  }
  throw new Error(`unexpected SQL in test: ${sql}`);
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: exec }),
  intType: () => "INTEGER",
  isConnectionError: () => false,
  isPostgres: () => false,
  isProductionServerlessFunctionRuntime: () => false,
}));

const store = await import("./identity-sso-store.js");

const STATE_INPUT = {
  returnPath: "/inbox",
  appId: "mail",
  clientId: "mail",
  redirectUri: "https://mail.agent-native.com/_agent-native/identity/callback",
  authority: "https://dispatch.agent-native.com",
  codeChallenge: "c".repeat(43),
} as const;

const EXPECTED_BINDING = {
  appId: STATE_INPUT.appId,
  clientId: STATE_INPUT.clientId,
  redirectUri: STATE_INPUT.redirectUri,
  authority: STATE_INPUT.authority,
  codeChallenge: STATE_INPUT.codeChallenge,
};

beforeEach(() => {
  flowStates.length = 0;
  jtis.clear();
});

afterEach(() => {
  delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
  delete process.env.APP_URL;
  delete process.env.BETTER_AUTH_URL;
  delete process.env.VITE_APP_URL;
  delete process.env.VITE_BETTER_AUTH_URL;
  delete process.env.URL;
  delete process.env.DEPLOY_PRIME_URL;
  delete process.env.DEPLOY_URL;
});

describe("identity SSO feature switch and request classifiers", () => {
  it("is disabled when the hub env is missing or malformed", () => {
    delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
    delete process.env.APP_URL;
    expect(store.getIdentityHubUrl()).toBeUndefined();
    expect(store.isIdentitySsoEnabled()).toBe(false);

    process.env.AGENT_NATIVE_IDENTITY_HUB_URL = "javascript:alert(1)";
    expect(store.getIdentityHubUrl()).toBeUndefined();
  });

  it("defaults canonical hosted clients to Dispatch but excludes the authority", () => {
    delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
    process.env.APP_URL = "https://mail.agent-native.com";
    expect(store.getIdentityHubUrl()).toBe("https://dispatch.agent-native.com");
    expect(store.isIdentitySsoEnabled()).toBe(true);

    process.env.APP_URL = "https://dispatch.agent-native.com";
    expect(store.getIdentityHubUrl()).toBeUndefined();
    expect(store.isIdentitySsoEnabled()).toBe(false);

    process.env.APP_URL = "https://workspace.example.test";
    expect(store.getIdentityHubUrl()).toBeUndefined();
  });

  it("normalizes a configured hub without accepting credentials or queries", () => {
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL =
      "https://dispatch.agent-native.com/";
    expect(store.getIdentityHubUrl()).toBe("https://dispatch.agent-native.com");
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL =
      "https://user:pass@dispatch.agent-native.com";
    expect(store.getIdentityHubUrl()).toBeUndefined();
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL =
      "http://dispatch.agent-native.com";
    expect(store.getIdentityHubUrl()).toBeUndefined();
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL = "http://localhost:3000";
    expect(store.getIdentityHubUrl()).toBe("http://localhost:3000");
  });

  it("recognizes only the packaged Canary marker and canonical hosts", () => {
    expect(
      store.isDesktopSsoCanaryUserAgent(
        "Mozilla/5.0 AgentNativeDesktopSsoCanary/1.2.3",
      ),
    ).toBe(true);
    expect(
      store.isDesktopSsoCanaryUserAgent("Mozilla/5.0 AgentNativeDesktop/1.2.3"),
    ).toBe(false);
    expect(
      store.isCanonicalAgentNativeAppRequest("mail.agent-native.com", "https"),
    ).toBe(true);
    expect(
      store.isCanonicalAgentNativeAppRequest("evil.agent-native.com", "https"),
    ).toBe(false);
    expect(
      store.isCanonicalIdentitySsoClientRequest(
        "mail.agent-native.com",
        "https",
      ),
    ).toBe(true);
    expect(
      store.isCanonicalIdentitySsoClientRequest(
        "dispatch.agent-native.com",
        "https",
      ),
    ).toBe(false);
  });
});

describe("bound SSO state", () => {
  it("rejects remote HTTP bindings while allowing loopback development", async () => {
    await expect(
      store.createSsoState({
        ...STATE_INPUT,
        authority: "http://dispatch.agent-native.com",
      }),
    ).rejects.toThrow("INVALID_SSO_STATE");
    await expect(
      store.createSsoState({
        ...STATE_INPUT,
        authority: "http://localhost:8080",
        redirectUri: "http://localhost:3000/_agent-native/identity/callback",
      }),
    ).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is single-use and returns the original safe return path", async () => {
    const state = await store.createSsoState(STATE_INPUT);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await store.consumeSsoState(state, EXPECTED_BINDING)).toEqual({
      ok: true,
      returnPath: "/inbox",
    });
    expect(await store.consumeSsoState(state, EXPECTED_BINDING)).toEqual({
      ok: false,
      returnPath: null,
    });
  });

  it("rejects an app, client, redirect, authority, or PKCE mismatch", async () => {
    const state = await store.createSsoState(STATE_INPUT);
    expect(
      await store.consumeSsoState(state, {
        ...EXPECTED_BINDING,
        redirectUri:
          "https://calendar.agent-native.com/_agent-native/identity/callback",
      }),
    ).toEqual({ ok: false, returnPath: null });
    expect(await store.consumeSsoState(state, EXPECTED_BINDING)).toEqual({
      ok: true,
      returnPath: "/inbox",
    });
  });

  it("rejects expired and unknown state", async () => {
    const state = await store.createSsoState(STATE_INPUT);
    flowStates[0].expires_at = Date.now() - 1;
    expect(await store.consumeSsoState(state, EXPECTED_BINDING)).toEqual({
      ok: false,
      returnPath: null,
    });
    expect(
      await store.consumeSsoState("x".repeat(43), EXPECTED_BINDING),
    ).toEqual({ ok: false, returnPath: null });
  });
});

describe("server assertion replay guard", () => {
  it("accepts a first jti and rejects a replay", async () => {
    expect(await store.isJtiReplayed("jti-1")).toBe(false);
    expect(await store.isJtiReplayed("jti-1")).toBe(true);
  });

  it("fails closed when the assertion has no jti", async () => {
    expect(await store.isJtiReplayed(undefined)).toBe(true);
  });
});
