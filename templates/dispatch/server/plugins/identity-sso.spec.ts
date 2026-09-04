import { createHash } from "node:crypto";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const featureFlagMocks = vi.hoisted(() => ({
  hasActiveRollout: vi.fn(),
  isEnabled: vi.fn(),
}));
const getSessionMock = vi.hoisted(() => vi.fn());
const signInJourneyMock = vi.hoisted(() => vi.fn());
const signA2ATokenMock = vi.hoisted(() => vi.fn());
const verifyA2ATokenMock = vi.hoisted(() => vi.fn());
const getOrgDomainMock = vi.hoisted(() => vi.fn());
const getOrgContextMock = vi.hoisted(() => vi.fn());
const invalidateMemberOrgCachesMock = vi.hoisted(() => vi.fn());
const hasGoogleAuthIdentityMock = vi.hoisted(() => vi.fn());

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
  org_id: string | null;
  org_name: string | null;
  org_role: "owner" | "admin" | "member" | null;
  jti: string;
  expires_at: number;
  consumed_at: number | null;
}
const codeRows: CodeRow[] = [];
let organizationRow: Record<string, unknown> | null = null;
let centralActorRole: string | null = null;
let centralMemberRole: string | null = null;

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
  verifyA2AToken: verifyA2ATokenMock,
}));
vi.mock("@agent-native/core/org", () => ({
  CROSS_APP_ORG_FEDERATION_FLAG: {
    key: "organization.cross-app-federation",
  },
  CROSS_APP_ORG_FEDERATION_SCOPE: "organization-federation",
  getOrgContext: getOrgContextMock,
  getOrgDomain: getOrgDomainMock,
  invalidateMemberOrgCaches: invalidateMemberOrgCachesMock,
}));
vi.mock("@agent-native/core/server", () => ({
  getH3App: vi.fn(() => ({ use: vi.fn() })),
  getSession: getSessionMock,
  hasGoogleAuthIdentity: hasGoogleAuthIdentityMock,
}));
vi.mock("@agent-native/core/shared", () => ({
  signInJourney: signInJourneyMock,
}));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => {
    const execute = async (
      input: string | { sql: string; args?: unknown[] },
    ) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      const args = (
        typeof input === "string" ? [] : (input.args ?? [])
      ) as any[];
      if (/^CREATE TABLE/i.test(sql)) return { rows: [], rowsAffected: 0 };
      if (
        /^SELECT id, name(?:, identity_authority, identity_id(?:,\s+federation_roster_initialized_at)?)?\s+FROM organizations/i.test(
          sql,
        )
      ) {
        return {
          rows: organizationRow ? [organizationRow] : [],
          rowsAffected: 0,
        };
      }
      if (/^INSERT INTO organizations/i.test(sql)) {
        return { rows: [], rowsAffected: 1 };
      }
      if (/^UPDATE organizations/i.test(sql)) {
        return { rows: [], rowsAffected: 1 };
      }
      if (/^INSERT INTO org_members/i.test(sql)) {
        return { rows: [], rowsAffected: 1 };
      }
      if (
        /^SELECT role(?:, federation_removal_pending_at)? FROM org_members/i.test(
          sql,
        )
      ) {
        const email = String(args[1] ?? "");
        return {
          rows: (
            email === "owner@example.test"
              ? centralActorRole
              : centralMemberRole
          )
            ? [
                {
                  role:
                    email === "owner@example.test"
                      ? centralActorRole
                      : centralMemberRole,
                },
              ]
            : [],
          rowsAffected: 0,
        };
      }
      if (
        /^SELECT email, role, federation_removal_pending_at\s+FROM org_members/i.test(
          sql,
        )
      ) {
        return {
          rows: [{ email: "owner@example.test", role: "owner" }],
          rowsAffected: 0,
        };
      }
      if (/^DELETE FROM org_members/i.test(sql)) {
        centralMemberRole = null;
        return { rows: [], rowsAffected: 1 };
      }
      if (/^UPDATE org_members/i.test(sql)) {
        return { rows: [], rowsAffected: 1 };
      }
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
          org_id: args[14],
          org_name: args[15],
          org_role: args[16],
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
    };
    return {
      execute,
      transaction: async (fn: (tx: { execute: typeof execute }) => unknown) =>
        fn({ execute }),
    };
  },
  intType: () => "INTEGER",
  isProductionServerlessFunctionRuntime: () => false,
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
  canAttemptBrowserIdentitySso,
  isBrowserIdentitySsoEnabledForSession,
  isDesktopWorkspaceSsoRequest,
  isWorkspaceSsoEnabledForSession,
  tokenHandler,
  organizationFederationHandler,
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
  organizationRow = null;
  centralActorRole = null;
  centralMemberRole = null;
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
  hasGoogleAuthIdentityMock.mockResolvedValue(false);
  getOrgContextMock.mockResolvedValue({
    orgId: "org-1",
    orgName: "Example Org",
    role: "owner",
  });
  signA2ATokenMock.mockResolvedValue("server-only-assertion");
  verifyA2ATokenMock.mockResolvedValue({
    email: "owner@example.test",
    orgDomain: null,
    orgId: "dispatch-org-1",
    claims: {
      iss: "https://mail.agent-native.com",
      app_id: "mail",
      scope: "organization-federation",
      org_name: "Example Org",
      org_role: "owner",
    },
  });
});

afterEach(() => {
  delete process.env.APP_URL;
  delete process.env.BETTER_AUTH_URL;
  delete process.env.A2A_SECRET;
  delete process.env.IDENTITY_SSO_APP_REGISTRY_JSON;
});

describe("rollout availability", () => {
  it("recognizes stable Desktop requests as well as the legacy Canary marker", () => {
    expect(isDesktopWorkspaceSsoRequest("AgentNativeDesktop/1.0")).toBe(true);
    expect(
      isDesktopWorkspaceSsoRequest("AgentNativeDesktopSsoCanary/1.0"),
    ).toBe(true);
    expect(isDesktopWorkspaceSsoRequest("Mozilla/5.0")).toBe(false);
  });

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

  it("keeps authenticated availability strict after the anonymous hint", async () => {
    featureFlagMocks.hasActiveRollout.mockResolvedValue(true);
    featureFlagMocks.isEnabled.mockResolvedValue(false);
    const response = await availabilityHandler(
      event("/_agent-native/identity/availability", {
        headers: {
          "user-agent": "AgentNativeDesktopSsoCanary/1.0",
        },
      }),
    );
    expect(await response.json()).toEqual({ available: false });
    expect(featureFlagMocks.isEnabled).toHaveBeenCalled();
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

  it("evaluates the browser silent-sign-in flag against the rollout", async () => {
    featureFlagMocks.hasActiveRollout.mockResolvedValue(true);
    featureFlagMocks.isEnabled.mockResolvedValue(true);

    await expect(canAttemptBrowserIdentitySso()).resolves.toBe(true);
    await expect(
      isBrowserIdentitySsoEnabledForSession({
        email: "user@example.test",
        orgId: "org-1",
      } as never),
    ).resolves.toBe(true);
    expect(featureFlagMocks.isEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ key: "browser.identity-sso" }),
      expect.objectContaining({ userEmail: "user@example.test" }),
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
    expect(signA2ATokenMock).toHaveBeenCalledWith(
      "user@example.test",
      "example.test",
      undefined,
      expect.objectContaining({
        extraClaims: expect.not.objectContaining({
          identity_auth_provider: "google",
        }),
      }),
    );
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

  it("carries the active canonical organization when federation is enabled", async () => {
    featureFlagMocks.hasActiveRollout.mockResolvedValue(true);
    featureFlagMocks.isEnabled.mockResolvedValue(true);
    getOrgContextMock.mockResolvedValue({
      orgId: "dispatch-org-1",
      orgName: "Example Org",
      role: "owner",
    });

    const redirect = await authorizeHandler(
      event(
        `/_agent-native/identity/authorize?response_type=code&app=mail&client_id=mail&redirect_uri=${encodeURIComponent(CALLBACK)}&state=${STATE}&code_challenge=${createCodeChallenge(VERIFIER)}&code_challenge_method=S256`,
      ),
    );
    const code = new URL(redirect.headers.get("Location")!).searchParams.get(
      "code",
    )!;

    expect(codeRows[0]).toMatchObject({
      org_id: "dispatch-org-1",
      org_name: "Example Org",
      org_role: "owner",
    });

    await tokenHandler(
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
    expect(signA2ATokenMock).toHaveBeenCalledWith(
      "user@example.test",
      "example.test",
      undefined,
      expect.objectContaining({
        extraClaims: expect.objectContaining({
          org_id: "dispatch-org-1",
          org_name: "Example Org",
          org_role: "owner",
        }),
      }),
    );
  });

  it("marks only Google-linked authority identities as Google-backed", async () => {
    hasGoogleAuthIdentityMock.mockResolvedValue(true);
    const challenge = createCodeChallenge(VERIFIER)!;
    const authorizeEvent = event(
      `/_agent-native/identity/authorize?response_type=code&app=mail&client_id=mail&redirect_uri=${encodeURIComponent(CALLBACK)}&state=${STATE}&code_challenge=${challenge}&code_challenge_method=S256`,
    );
    const redirect = await authorizeHandler(authorizeEvent);
    const code = new URL(redirect.headers.get("Location")!).searchParams.get(
      "code",
    )!;
    await tokenHandler(
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
    expect(signA2ATokenMock).toHaveBeenCalledWith(
      "user@example.test",
      "example.test",
      undefined,
      expect.objectContaining({
        extraClaims: expect.objectContaining({
          identity_auth_provider: "google",
        }),
      }),
    );
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

  it("rejects silent prompts from custom browser registrations", async () => {
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
        `/_agent-native/identity/authorize?response_type=code&app=custom&client_id=custom-client&redirect_uri=${encodeURIComponent("https://workspace.example.com/_agent-native/identity/callback")}&state=${STATE}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256&prompt=none`,
      ),
    );
    expect(response.status).toBe(400);
    expect(getSessionMock).not.toHaveBeenCalled();
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

  it("does not let anonymous discovery bypass the authenticated target check", async () => {
    featureFlagMocks.hasActiveRollout.mockResolvedValue(true);
    featureFlagMocks.isEnabled.mockResolvedValue(false);
    const response = await authorizeHandler(
      event(
        `/_agent-native/identity/authorize?response_type=code&app=mail&client_id=mail&redirect_uri=${encodeURIComponent(CALLBACK)}&state=${STATE}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256`,
        {
          headers: { "user-agent": "AgentNativeDesktopSsoCanary/1.0" },
        },
      ),
    );
    expect(response.status).toBe(404);
    expect(featureFlagMocks.isEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ key: "desktop.workspace-sso" }),
      expect.objectContaining({ orgId: "org-1" }),
    );
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

  it("returns login_required for a silent browser probe without a Dispatch session", async () => {
    getSessionMock.mockResolvedValue(null);
    featureFlagMocks.hasActiveRollout.mockResolvedValue(true);
    const response = await authorizeHandler(
      event(
        `/_agent-native/identity/authorize?response_type=code&app=mail&client_id=mail&redirect_uri=${encodeURIComponent(CALLBACK)}&state=${STATE}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256&prompt=none`,
      ),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin).toBe("https://mail.agent-native.com");
    expect(location.searchParams.get("error")).toBe("login_required");
    expect(location.searchParams.get("state")).toBe(STATE);
    expect(signInJourneyMock).not.toHaveBeenCalled();
  });

  it("returns feature_disabled when the silent browser flag is off", async () => {
    getSessionMock.mockResolvedValue(null);
    featureFlagMocks.hasActiveRollout.mockResolvedValue(false);
    const response = await authorizeHandler(
      event(
        `/_agent-native/identity/authorize?response_type=code&app=mail&client_id=mail&redirect_uri=${encodeURIComponent(CALLBACK)}&state=${STATE}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256&prompt=none`,
      ),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.searchParams.get("error")).toBe("feature_disabled");
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported prompt values before resolving a session", async () => {
    const response = await authorizeHandler(
      event(
        `/_agent-native/identity/authorize?response_type=code&app=mail&client_id=mail&redirect_uri=${encodeURIComponent(CALLBACK)}&state=${STATE}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256&prompt=login`,
      ),
    );

    expect(response.status).toBe(400);
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});

describe("organization federation endpoint", () => {
  it("atomically bootstraps the existing owner roster", async () => {
    featureFlagMocks.isEnabled.mockImplementation(async (flag) => {
      return flag.key === "organization.cross-app-federation";
    });
    const roster = {
      members: [
        { email: "admin@example.test", role: "admin" },
        { email: "member@example.test", role: "member" },
        { email: "owner@example.test", role: "owner" },
      ],
    };
    const rosterHash = createHash("sha256")
      .update(JSON.stringify(roster))
      .digest("base64url");
    verifyA2ATokenMock.mockResolvedValue({
      email: "owner@example.test",
      orgDomain: null,
      orgId: "dispatch-org-1",
      claims: {
        iss: "https://mail.agent-native.com",
        app_id: "mail",
        scope: "organization-federation",
        org_name: "Example Org",
        org_role: "owner",
        federation_roster_hash: rosterHash,
      },
    });

    const response = await organizationFederationHandler(
      event("/_agent-native/identity/organization", {
        method: "POST",
        body: roster,
        headers: { authorization: "Bearer roster-assertion" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      orgId: "dispatch-org-1",
      rosterInitialized: true,
    });
    expect(verifyA2ATokenMock).toHaveBeenCalledWith(
      "roster-assertion",
      expect.anything(),
      expect.objectContaining({ globalSecretOnly: true }),
    );
  });

  it("bootstraps missing members on a mapped organization only once", async () => {
    featureFlagMocks.isEnabled.mockImplementation(async (flag) => {
      return flag.key === "organization.cross-app-federation";
    });
    organizationRow = {
      id: "dispatch-org-1",
      name: "Example Org",
      identity_authority: AUTHORITY,
      identity_id: "dispatch-org-1",
    };
    centralActorRole = "owner";
    const roster = {
      members: [
        { email: "member@example.test", role: "member" },
        { email: "owner@example.test", role: "owner" },
      ],
    };
    const rosterHash = createHash("sha256")
      .update(JSON.stringify(roster))
      .digest("base64url");
    verifyA2ATokenMock.mockResolvedValue({
      email: "owner@example.test",
      orgDomain: null,
      orgId: "dispatch-org-1",
      claims: {
        iss: "https://mail.agent-native.com",
        app_id: "mail",
        scope: "organization-federation",
        org_name: "Example Org",
        org_role: "owner",
        federation_roster_hash: rosterHash,
      },
    });

    const response = await organizationFederationHandler(
      event("/_agent-native/identity/organization", {
        method: "POST",
        body: roster,
        headers: { authorization: "Bearer mapped-roster-assertion" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      orgId: "dispatch-org-1",
      rosterInitialized: true,
    });
  });

  it("accepts only a verified assertion from an exact registered app", async () => {
    featureFlagMocks.isEnabled.mockImplementation(async (flag) => {
      return flag.key === "organization.cross-app-federation";
    });

    const response = await organizationFederationHandler(
      event("/_agent-native/identity/organization", {
        method: "POST",
        headers: {
          authorization: "Bearer signed-org-assertion",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orgId: "dispatch-org-1",
      name: "Example Org",
      role: "owner",
    });
    expect(verifyA2ATokenMock).toHaveBeenCalledWith(
      "signed-org-assertion",
      expect.anything(),
      expect.objectContaining({
        globalSecretOnly: true,
        includeClaims: true,
      }),
    );
  });

  it("revokes a copied member using only the global federation secret", async () => {
    featureFlagMocks.isEnabled.mockImplementation(async (flag) => {
      return flag.key === "organization.cross-app-federation";
    });
    organizationRow = {
      id: "dispatch-org-1",
      name: "Example Org",
      identity_authority: AUTHORITY,
      identity_id: "dispatch-org-1",
    };
    centralActorRole = "owner";
    centralMemberRole = "member";
    verifyA2ATokenMock.mockResolvedValue({
      email: "owner@example.test",
      orgDomain: null,
      orgId: "dispatch-org-1",
      claims: {
        iss: "https://slides.agent-native.com",
        app_id: "slides",
        scope: "organization-federation",
        org_name: "Example Org",
        org_role: "owner",
        federation_operation: "remove-member",
        federation_member_email: "removed@example.test",
      },
    });

    const response = await organizationFederationHandler(
      event("/_agent-native/identity/organization", {
        method: "POST",
        headers: {
          authorization: "Bearer signed-revocation-assertion",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      orgId: "dispatch-org-1",
      removedMember: "removed@example.test",
    });
    expect(centralMemberRole).toBeNull();
    expect(verifyA2ATokenMock).toHaveBeenCalledWith(
      "signed-revocation-assertion",
      expect.anything(),
      expect.objectContaining({ globalSecretOnly: true }),
    );
  });

  it("authorizes revocation from the central roster, not the asserted role", async () => {
    featureFlagMocks.isEnabled.mockImplementation(async (flag) => {
      return flag.key === "organization.cross-app-federation";
    });
    organizationRow = {
      id: "dispatch-org-1",
      name: "Example Org",
      identity_authority: AUTHORITY,
      identity_id: "dispatch-org-1",
    };
    centralActorRole = "member";
    centralMemberRole = "member";
    verifyA2ATokenMock.mockResolvedValue({
      email: "owner@example.test",
      orgDomain: null,
      orgId: "dispatch-org-1",
      claims: {
        iss: "https://slides.agent-native.com",
        app_id: "slides",
        scope: "organization-federation",
        org_name: "Example Org",
        org_role: "owner",
        federation_operation: "remove-member",
        federation_member_email: "removed@example.test",
      },
    });

    const response = await organizationFederationHandler(
      event("/_agent-native/identity/organization", {
        method: "POST",
        headers: { authorization: "Bearer forged-role-assertion" },
      }),
    );

    expect(response.status).toBe(403);
    expect(centralMemberRole).toBe("member");
  });

  it("does not recreate a centrally revoked member from an ordinary stale sync", async () => {
    featureFlagMocks.isEnabled.mockImplementation(async (flag) => {
      return flag.key === "organization.cross-app-federation";
    });
    organizationRow = {
      id: "dispatch-org-1",
      name: "Example Org",
      identity_authority: AUTHORITY,
      identity_id: "dispatch-org-1",
    };
    verifyA2ATokenMock.mockResolvedValue({
      email: "removed@example.test",
      orgDomain: null,
      orgId: "dispatch-org-1",
      claims: {
        iss: "https://clips.agent-native.com",
        app_id: "clips",
        scope: "organization-federation",
        org_name: "Example Org",
        org_role: "member",
      },
    });

    const response = await organizationFederationHandler(
      event("/_agent-native/identity/organization", {
        method: "POST",
        headers: { authorization: "Bearer stale-member-assertion" },
      }),
    );

    expect(response.status).toBe(403);
    expect(centralMemberRole).toBeNull();
  });

  it("requires a central owner or admin for explicit membership additions", async () => {
    featureFlagMocks.isEnabled.mockImplementation(async (flag) => {
      return flag.key === "organization.cross-app-federation";
    });
    organizationRow = {
      id: "dispatch-org-1",
      name: "Example Org",
      identity_authority: AUTHORITY,
      identity_id: "dispatch-org-1",
    };
    centralActorRole = "owner";
    centralMemberRole = null;
    verifyA2ATokenMock.mockResolvedValue({
      email: "owner@example.test",
      orgDomain: null,
      orgId: "dispatch-org-1",
      claims: {
        iss: "https://slides.agent-native.com",
        app_id: "slides",
        scope: "organization-federation",
        org_name: "Example Org",
        org_role: "owner",
        federation_operation: "add-member",
        federation_member_email: "new@example.test",
        federation_member_role: "member",
      },
    });

    const response = await organizationFederationHandler(
      event("/_agent-native/identity/organization", {
        method: "POST",
        headers: { authorization: "Bearer add-member-assertion" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      orgId: "dispatch-org-1",
      memberEmail: "new@example.test",
      role: "member",
    });
  });

  it("rejects an explicit add that conflicts with the central role", async () => {
    featureFlagMocks.isEnabled.mockImplementation(async (flag) => {
      return flag.key === "organization.cross-app-federation";
    });
    organizationRow = {
      id: "dispatch-org-1",
      name: "Example Org",
      identity_authority: AUTHORITY,
      identity_id: "dispatch-org-1",
    };
    centralActorRole = "owner";
    centralMemberRole = "admin";
    verifyA2ATokenMock.mockResolvedValue({
      email: "owner@example.test",
      orgDomain: null,
      orgId: "dispatch-org-1",
      claims: {
        iss: "https://slides.agent-native.com",
        app_id: "slides",
        scope: "organization-federation",
        org_name: "Example Org",
        org_role: "owner",
        federation_operation: "add-member",
        federation_member_email: "member@example.test",
        federation_member_role: "member",
      },
    });

    const response = await organizationFederationHandler(
      event("/_agent-native/identity/organization", {
        method: "POST",
        headers: { authorization: "Bearer conflicting-add-assertion" },
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Organization membership role conflict",
    });
  });

  it("answers satellite membership checks from the current central roster", async () => {
    featureFlagMocks.isEnabled.mockImplementation(async (flag) => {
      return flag.key === "organization.cross-app-federation";
    });
    organizationRow = {
      id: "dispatch-org-1",
      name: "Example Org",
      identity_authority: AUTHORITY,
      identity_id: "dispatch-org-1",
    };
    centralMemberRole = "admin";
    verifyA2ATokenMock.mockResolvedValue({
      email: "member@example.test",
      orgDomain: null,
      orgId: "dispatch-org-1",
      claims: {
        iss: "https://slides.agent-native.com",
        app_id: "slides",
        scope: "organization-federation",
        org_name: "Example Org",
        org_role: "member",
        federation_operation: "check-member",
        federation_member_email: "member@example.test",
      },
    });

    const response = await organizationFederationHandler(
      event("/_agent-native/identity/organization", {
        method: "POST",
        headers: { authorization: "Bearer membership-check-assertion" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      orgId: "dispatch-org-1",
      memberEmail: "member@example.test",
      memberPresent: true,
      memberRole: "admin",
    });
  });

  it("lets a pending member retry its own authority removal idempotently", async () => {
    featureFlagMocks.isEnabled.mockImplementation(async (flag) => {
      return flag.key === "organization.cross-app-federation";
    });
    organizationRow = {
      id: "dispatch-org-1",
      name: "Example Org",
      identity_authority: AUTHORITY,
      identity_id: "dispatch-org-1",
      federation_roster_initialized_at: Date.now(),
    };
    verifyA2ATokenMock.mockResolvedValue({
      email: "removed@example.test",
      orgDomain: null,
      orgId: "dispatch-org-1",
      claims: {
        iss: "https://slides.agent-native.com",
        app_id: "slides",
        scope: "organization-federation",
        org_name: "Example Org",
        org_role: "member",
        federation_operation: "remove-member",
        federation_member_email: "removed@example.test",
      },
    });

    const response = await organizationFederationHandler(
      event("/_agent-native/identity/organization", {
        method: "POST",
        headers: { authorization: "Bearer pending-cleanup-assertion" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      removedMember: "removed@example.test",
    });
  });
});
