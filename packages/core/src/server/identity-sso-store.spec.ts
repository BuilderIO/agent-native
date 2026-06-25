import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory SQL simulator rich enough for the two identity-SSO tables. We
 * pattern-match the small fixed set of statements the store issues — same
 * approach as `mcp/connect-store.spec.ts`.
 */
interface StateRow {
  state: string;
  return_path: string | null;
  created_at: number | null;
  expires_at: number | null;
  consumed_at: number | null;
}
let states: StateRow[] = [];
let jtis: { jti: string; seen_at: number }[] = [];

const exec = async (input: string | { sql: string; args?: unknown[] }) => {
  const sql = (typeof input === "string" ? input : input.sql).trim();
  const args = (typeof input === "string" ? [] : (input.args ?? [])) as any[];

  if (/^CREATE TABLE/i.test(sql)) return { rows: [], rowsAffected: 0 };

  // --- identity_sso_state ---
  if (/^SELECT COUNT\(\*\) AS n FROM identity_sso_state/i.test(sql)) {
    const since = args[0] as number;
    const n = states.filter((s) => (s.created_at ?? 0) > since).length;
    return { rows: [{ n }], rowsAffected: 0 };
  }
  if (/^INSERT INTO identity_sso_state/i.test(sql)) {
    states.push({
      state: args[0],
      return_path: args[1],
      created_at: args[2],
      expires_at: args[3],
      consumed_at: args[4],
    });
    return { rows: [], rowsAffected: 1 };
  }
  if (
    /^SELECT state, return_path, expires_at, consumed_at FROM identity_sso_state WHERE state = \?/i.test(
      sql,
    )
  ) {
    const r = states.find((s) => s.state === args[0]);
    return {
      rows: r
        ? [
            {
              state: r.state,
              return_path: r.return_path,
              expires_at: r.expires_at,
              consumed_at: r.consumed_at,
            },
          ]
        : [],
      rowsAffected: 0,
    };
  }
  if (
    /^UPDATE identity_sso_state SET consumed_at = \? WHERE state = \? AND consumed_at IS NULL/i.test(
      sql,
    )
  ) {
    const r = states.find((s) => s.state === args[1]);
    if (r && r.consumed_at == null) {
      r.consumed_at = args[0];
      return { rows: [], rowsAffected: 1 };
    }
    return { rows: [], rowsAffected: 0 };
  }

  // --- identity_sso_jti ---
  if (/^INSERT INTO identity_sso_jti/i.test(sql)) {
    if (jtis.some((j) => j.jti === args[0])) {
      const e: any = new Error(
        "UNIQUE constraint failed: identity_sso_jti.jti",
      );
      throw e;
    }
    jtis.push({ jti: args[0], seen_at: args[1] });
    return { rows: [], rowsAffected: 1 };
  }

  throw new Error("unexpected SQL in test: " + sql);
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: exec }),
  isConnectionError: () => false,
  intType: () => "INTEGER",
  // isPostgres is false in tests so the SQLite branch runs (no lock plumbing
  // needed) and the ddl-guard helpers imported by the store become no-ops.
  isPostgres: () => false,
}));

const store = await import("./identity-sso-store.js");

beforeEach(() => {
  states = [];
  jtis = [];
});
afterEach(() => {
  delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
});

describe("getIdentityHubUrl / isIdentitySsoEnabled", () => {
  it("returns undefined / false when the env is unset", () => {
    delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
    expect(store.getIdentityHubUrl()).toBeUndefined();
    expect(store.isIdentitySsoEnabled()).toBe(false);
  });

  it("normalises a valid https URL and strips trailing slashes", () => {
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL =
      "https://dispatch.agent-native.com/";
    expect(store.getIdentityHubUrl()).toBe("https://dispatch.agent-native.com");
    expect(store.isIdentitySsoEnabled()).toBe(true);
  });

  it("treats a malformed value as OFF (no throw)", () => {
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL = "not a url";
    expect(store.getIdentityHubUrl()).toBeUndefined();
    expect(store.isIdentitySsoEnabled()).toBe(false);
  });

  it("rejects a non-http(s) scheme", () => {
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL = "javascript:alert(1)";
    expect(store.getIdentityHubUrl()).toBeUndefined();
  });
});

describe("CSRF state — single use + expiry", () => {
  it("a freshly minted state is consumable exactly once", async () => {
    const s = await store.createSsoState("/inbox");
    const first = await store.consumeSsoState(s);
    expect(first).toEqual({ ok: true, returnPath: "/inbox" });
    const second = await store.consumeSsoState(s);
    expect(second.ok).toBe(false);
  });

  it("an unknown state is rejected", async () => {
    expect((await store.consumeSsoState("nope")).ok).toBe(false);
    expect((await store.consumeSsoState("")).ok).toBe(false);
  });

  it("an expired state is rejected", async () => {
    const s = await store.createSsoState(null);
    // Force the stored row to be expired.
    states[0].expires_at = Date.now() - 1000;
    expect((await store.consumeSsoState(s)).ok).toBe(false);
  });
});

describe("jti replay guard", () => {
  it("first sighting is not a replay; the second is", async () => {
    expect(await store.isJtiReplayed("abc")).toBe(false);
    expect(await store.isJtiReplayed("abc")).toBe(true);
  });

  it("an undefined jti is never treated as a replay", async () => {
    expect(await store.isJtiReplayed(undefined)).toBe(false);
    expect(await store.isJtiReplayed(undefined)).toBe(false);
  });
});
