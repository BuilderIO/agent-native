import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const featureFlagMocks = vi.hoisted(() => ({
  hasActiveRollout: vi.fn(),
  isEnabled: vi.fn(),
}));
const getSessionMock = vi.hoisted(() => vi.fn());
const signInJourneyMock = vi.hoisted(() => vi.fn());
const signA2ATokenMock = vi.hoisted(() => vi.fn());
const getOrgDomainMock = vi.hoisted(() => vi.fn());

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

vi.mock("@agent-native/core/feature-flags", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/feature-flags")
  >("@agent-native/core/feature-flags");
  return {
    ...actual,
    hasActiveFeatureFlagRollout: featureFlagMocks.hasActiveRollout,
    isFeatureFlagEnabled: featureFlagMocks.isEnabled,
  };
});

vi.mock("@agent-native/core/a2a", () => ({
  signA2AToken: signA2ATokenMock,
}));
vi.mock("@agent-native/core/org", () => ({
  getOrgDomain: getOrgDomainMock,
}));
vi.mock("@agent-native/core/server", () => ({
  getH3App: vi.fn(() => ({ use: vi.fn() })),
  getSession: getSessionMock,
}));
vi.mock("@agent-native/core/shared", () => ({
  signInJourney: signInJourneyMock,
}));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      const args = (
        typeof input === "string" ? [] : (input.args ?? [])
      ) as any[];
      if (/^CREATE TABLE/i.test(sql)) return { rows: [], rowsAffected: 0 };
      if (/^DELETE FROM identity_sso_authorization_code/i.test(sql)) {
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
        const row = codeRows.find(
          (candidate) => candidate.code_hash === args[0],
        );
        return { rows: row ? [{ ...row }] : [], rowsAffected: 0 };
      }
      if (
        /^UPDATE identity_sso_authorization_code SET consumed_at/i.test(sql)
      ) {
        const row = codeRows.find(
          (candidate) => candidate.code_hash === args[1],
        );
        if (row && row.consumed_at == null) {
          row.consumed_at = args[0];
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    },
  }),
  intType: () => "INTEGER",
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getHeader: (event: any, name: string) =>
    event.headers?.[name.toLowerCase()] ?? event.headers?.[name],
  getMethod: (event: any) => event.method ?? "GET",
  readBody: async (event: any) => event.body,
}));

const {
  authorizeHandler,
  availabilityHandler,
  canAttemptWorkspaceSso,
  isDesktopWorkspaceSsoRequest,
  isWorkspaceSsoEnabledForSession,
  tokenHandler,
} = await import("./identity-sso.js");
const { createCodeChallenge } = await import("../lib/identity-sso.js");

const AUTHORITY = "https://dispatch.agent-native.com";
const CALLBACK =
  "https://mail.agent-native.com/_agent-native/identity/callback";
const STATE = "s".repeat(43);
const VERIFIER = "v".repeat(64);

function event(path: string, extra: Record<string, unknown> = {}): any {
  return {
    method: "GET",
    headers: {
      host: "dispatch.agent-native.com",
      "user-agent": "Mozilla/5.0 Chrome/140",
      ...((extra.headers as Record<string, string> | undefined) ?? {}),
    },
    node: { req: { url: path } },
    path,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  codeRows.length = 0;
  process.env.APP_URL = AUTHORITY;
  process.env.A2A_SECRET = "test-a2a-secret";
  featureFlagMocks.hasActiveRollout.mockResolvedValue(false);
  featureFlagMocks.isEnabled.mockResolvedValue(false);
  getSessionMock.mockResolvedValue({
    email: "user@example.test",
    name: "User",
    orgId: "org-1",
  });
  signInJourneyMock.mockReturnValue({ signInHref: "/_agent-native/sign-in" });
  getOrgDomainMock.mockResolvedValue("example.test");
  signA2ATokenMock.mockResolvedValue("server-only-assertion");
});

afterEach(() => {
  delete process.env.APP_URL;
  delete process.env.BETTER_AUTH_URL;
  delete process.env.A2A_SECRET;
  delete process.env.IDENTITY_SSO_APP_REGISTRY_JSON;
});

describe("rollout availability", () => {
  it("keeps ordinary anonymous browser availability false", async () => {
    getSessionMock.mockResolvedValue(null);
    featureFlagMocks.hasActiveRollout.mockResolvedValue(true);
    const response = await availabilityHandler(
      event("/_agent-native/identity/availability"),
    );
    expect(await response.json()).toEqual({ available: false });
  });

  it("exposes only a Canary availability hint for anonymous Desktop", async () => {
    getSessionMock.mockResolvedValue(null);
    featureFlagMocks.hasActiveRollout.mockResolvedValue(true);
    const response = await availabilityHandler(
      event("/_agent-native/identity/availability", {
        headers: {
          "user-agent": "AgentNativeDesktopSsoCanary/1.0",
        },
      }),
    );
    expect(await response.json()).toEqual({ available: true });
  });

  it("fails closed when rollout state is missing or unreadable", async () => {
    featureFlagMocks.hasActiveRollout.mockResolvedValue(false);
    await expect(canAttemptWorkspaceSso()).resolves.toBe(false);
    featureFlagMocks.hasActiveRollout.mockRejectedValue(
      new Error("unavailable"),
    );
    await expect(canAttemptWorkspaceSso()).resolves.toBe(false);
  });

  it("evaluates the authenticated session against the rollout flag", async () => {
    featureFlagMocks.isEnabled.mockResolvedValue(true);
    await expect(
      isWorkspaceSsoEnabledForSession({
        email: "user@example.test",
        orgId: "org-1",
      } as never),
    ).resolves.toBe(true);
    expect(featureFlagMocks.isEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ key: "desktop.workspace-sso" }),
      {
        userEmail: "user@example.test",
        userKey: "user@example.test",
        orgId: "org-1",
      },
    );
  });
});

describe("authorization code and PKCE handlers", () => {
  it("issues a code and exchanges it once with exact bindings", async () => {
    const challenge = createCodeChallenge(VERIFIER)!;
    const authorizeEvent = event(
      `/_agent-native/identity/authorize?response_type=code&app=mail&client_id=mail&redirect_uri=${encodeURIComponent(CALLBACK)}&state=${STATE}&code_challenge=${challenge}&code_challenge_method=S256`,
    );
    const redirect = await authorizeHandler(authorizeEvent);
    expect(redirect.status).toBe(302);
    const location = new URL(redirect.headers.get("Location")!);
    const code = location.searchParams.get("code")!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("state")).toBe(STATE);
    expect(location.searchParams.has("token")).toBe(false);

    const tokenResponse = await tokenHandler(
      event("/_agent-native/identity/token", {
        method: "POST",
        body: {
          grant_type: "authorization_code",
          code,
          state: STATE,
          app_id: "mail",
          client_id: "mail",
          redirect_uri: CALLBACK,
          code_verifier: VERIFIER,
        },
      }),
    );
    expect(tokenResponse.status).toBe(200);
    expect(await tokenResponse.json()).toMatchObject({
      assertion: "server-only-assertion",
      token_type: "identity-assertion",
    });
    const replay = await tokenHandler(
      event("/_agent-native/identity/token", {
        method: "POST",
        body: {
          grant_type: "authorization_code",
          code,
          state: STATE,
          app_id: "mail",
          client_id: "mail",
          redirect_uri: CALLBACK,
          code_verifier: VERIFIER,
        },
      }),
    );
    expect(replay.status).toBe(400);
    expect(signA2ATokenMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unregistered custom redirect before session resolution", async () => {
    const response = await authorizeHandler(
      event(
        `/_agent-native/identity/authorize?response_type=code&app=custom&client_id=custom&redirect_uri=${encodeURIComponent("https://workspace.example.com/_agent-native/identity/callback")}&state=${STATE}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256`,
      ),
    );
    expect(response.status).toBe(400);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("rejects a custom redirect unless its server registration is exact", async () => {
    process.env.IDENTITY_SSO_APP_REGISTRY_JSON = JSON.stringify([
      {
        appId: "custom",
        clientId: "custom-client",
        origin: "https://workspace.example.com",
        callbackPath: "/_agent-native/identity/callback",
        capabilities: ["identity-sso"],
      },
    ]);
    const response = await authorizeHandler(
      event(
        `/_agent-native/identity/authorize?response_type=code&app=custom&client_id=custom-client&redirect_uri=${encodeURIComponent("https://workspace.example.com/_agent-native/identity/callback")}&state=${STATE}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256`,
      ),
    );
    expect(response.status).toBe(302);
  });

  it("keeps the default-off Desktop flag as a hard availability gate", async () => {
    const response = await authorizeHandler(
      event(
        `/_agent-native/identity/authorize?response_type=code&app=mail&client_id=mail&redirect_uri=${encodeURIComponent(CALLBACK)}&state=${STATE}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256`,
        {
          headers: { "user-agent": "AgentNativeDesktopSsoCanary/1.0" },
        },
      ),
    );
    expect(
      isDesktopWorkspaceSsoRequest("AgentNativeDesktopSsoCanary/1.0"),
    ).toBe(true);
    expect(response.status).toBe(404);
  });

  it("bounces a logged-out browser through the existing sign-in journey", async () => {
    getSessionMock.mockResolvedValue(null);
    const response = await authorizeHandler(
      event(
        `/_agent-native/identity/authorize?response_type=code&app=mail&client_id=mail&redirect_uri=${encodeURIComponent(CALLBACK)}&state=${STATE}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256`,
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/_agent-native/sign-in");
    expect(signInJourneyMock).toHaveBeenCalled();
  });
});
