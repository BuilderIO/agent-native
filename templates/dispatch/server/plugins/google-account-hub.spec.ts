import { createApp } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyA2ATokenMock = vi.hoisted(() => vi.fn());
const getOAuthTokensMock = vi.hoisted(() => vi.fn());
const resolveConnectionsMock = vi.hoisted(() => vi.fn());
const registryMock = vi.hoisted(() => vi.fn());
const requestContexts = vi.hoisted(
  () => [] as Array<{ userEmail?: string; orgId?: string }>,
);

vi.mock("@agent-native/core/a2a", () => ({
  verifyA2AToken: verifyA2ATokenMock,
}));
vi.mock("@agent-native/core/connections", () => ({
  getWorkspaceConnectionProvider: (provider: string) =>
    provider === "google_calendar"
      ? {
          oauth: {
            scopes: [
              "openid",
              "https://www.googleapis.com/auth/calendar.readonly",
              "https://www.googleapis.com/auth/calendar.events",
            ],
          },
        }
      : undefined,
}));
vi.mock("@agent-native/core/oauth-tokens", () => ({
  getOAuthTokens: getOAuthTokensMock,
}));
vi.mock("@agent-native/core/org", () => ({
  resolveOrgIdForEmail: vi.fn(async () => "org-1"),
}));
vi.mock("@agent-native/core/server", () => ({
  getH3App: (app: unknown) => app,
  resolveGoogleProviderCredentialCandidatesWithReader: vi.fn(async () => [
    { clientId: "client-id", clientSecret: "client-secret" },
  ]),
  resolveSecret: vi.fn(),
  runWithRequestContext: (
    context: { userEmail?: string; orgId?: string },
    run: () => unknown,
  ) => {
    requestContexts.push(context);
    return run();
  },
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionsForApp: resolveConnectionsMock,
}));
vi.mock("../lib/identity-sso.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/identity-sso.js")>();
  return { ...actual, getIdentitySsoAppRegistry: registryMock };
});

import { googleAccountHubHandler } from "./google-account-hub.js";

const HUB_URL =
  "https://dispatch.example.test/_agent-native/google-accounts/token";
const CALENDAR = {
  appId: "calendar",
  clientId: "calendar",
  origin: "https://calendar.example.test",
  callbackPath: "/_agent-native/identity/callback",
  federationSecret: "calendar-secret",
};
const CLIPS = {
  appId: "clips",
  clientId: "clips",
  origin: "https://clips.example.test",
  callbackPath: "/_agent-native/identity/callback",
  federationSecret: "clips-secret",
};

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    provider: "google_calendar",
    accountId: "work@example.test",
    ownerEmail: "person@example.test",
    status: "connected",
    explicitGrant: null,
    ...overrides,
  };
}

/** A bearer the verifier mock reads as "signed with <secret> for <claims>". */
function assertion(secret: string, claims: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify({ secret, claims })).toString("base64url");
}

function calendarAssertion(overrides: Record<string, unknown> = {}): string {
  return assertion("calendar-secret", {
    sub: "Person@Example.test",
    scope: "google-account-hub",
    app_id: "calendar",
    iss: "https://calendar.example.test",
    ...overrides,
  });
}

async function request(
  token: string | null,
  body: unknown = { provider: "google_calendar" },
): Promise<Response> {
  const app = createApp();
  app.use(googleAccountHubHandler);
  return app.request(HUB_URL, {
    method: "POST",
    headers: {
      host: "dispatch.example.test",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const fetchMock = vi.fn();

describe("Google account hub", () => {
  beforeEach(() => {
    requestContexts.length = 0;
    registryMock.mockReset().mockReturnValue([CALENDAR, CLIPS]);
    verifyA2ATokenMock
      .mockReset()
      .mockImplementation(
        async (
          token: string,
          _event: unknown,
          options: { verificationSecret: string },
        ) => {
          const decoded = JSON.parse(
            Buffer.from(token, "base64url").toString("utf8"),
          );
          if (decoded.secret !== options.verificationSecret) {
            return { email: null, claims: null };
          }
          return { email: decoded.claims.sub, claims: decoded.claims };
        },
      );
    resolveConnectionsMock.mockReset().mockResolvedValue([connection()]);
    getOAuthTokensMock.mockReset().mockResolvedValue({
      refresh_token: "refresh-1",
      scope:
        "openid https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify",
    });
    fetchMock.mockReset().mockImplementation(async () =>
      Response.json({
        access_token: "access-1",
        expires_in: 3599,
        scope: "openid https://www.googleapis.com/auth/calendar.readonly",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a request with no bearer", async () => {
    const response = await request(null);
    expect(response.status).toBe(401);
    expect(resolveConnectionsMock).not.toHaveBeenCalled();
  });

  it("refuses an assertion no registered app signed", async () => {
    const response = await request(
      assertion("someone-else", {
        sub: "person@example.test",
        scope: "google-account-hub",
        app_id: "calendar",
        iss: "https://calendar.example.test",
      }),
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an app that names another app's ID", async () => {
    const response = await request(calendarAssertion({ app_id: "clips" }));
    expect(response.status).toBe(401);
    expect(resolveConnectionsMock).not.toHaveBeenCalled();
  });

  it("refuses an assertion issued from another origin", async () => {
    const response = await request(
      calendarAssertion({ iss: "https://evil.example.test" }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses an assertion minted for another purpose", async () => {
    const response = await request(
      calendarAssertion({ scope: "org-federation" }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses a provider outside Google", async () => {
    const response = await request(calendarAssertion(), { provider: "slack" });
    expect(response.status).toBe(400);
  });

  it("looks up grants for the app that signed, as the person it names", async () => {
    const response = await request(calendarAssertion(), {
      provider: "google_calendar",
      appId: "clips",
    });
    expect(response.status).toBe(200);
    expect(resolveConnectionsMock).toHaveBeenCalledWith({
      appId: "calendar",
      provider: "google_calendar",
    });
    expect(requestContexts[0]).toEqual({
      userEmail: "person@example.test",
      orgId: "org-1",
    });
    expect(getOAuthTokensMock).toHaveBeenCalledWith(
      "google",
      "work@example.test",
      "person@example.test",
    );
  });

  it("mints a token narrowed to the provider's scopes the stored token holds", async () => {
    const response = await request(calendarAssertion());
    const body = await response.json();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({
      accounts: [
        {
          account_email: "work@example.test",
          connection_id: "conn-1",
          access_token: "access-1",
          expires_in: 3599,
          scope: "openid https://www.googleapis.com/auth/calendar.readonly",
        },
      ],
      errors: [],
    });
    const sent = new URLSearchParams(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    );
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("scope")?.split(" ").sort()).toEqual(
      [
        "openid",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
      ].sort(),
    );
  });

  it("keeps an explicit grant's narrower scopes", async () => {
    resolveConnectionsMock.mockResolvedValue([
      connection({
        explicitGrant: {
          scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
        },
      }),
    ]);
    await request(calendarAssertion());
    const sent = new URLSearchParams(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    );
    expect(sent.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
  });

  it("returns nothing when no connection is granted to the app", async () => {
    resolveConnectionsMock.mockResolvedValue([]);
    const response = await request(calendarAssertion());
    expect(await response.json()).toEqual({ accounts: [], errors: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips connections that aren't connected", async () => {
    resolveConnectionsMock.mockResolvedValue([
      connection({ status: "needs_reauth" }),
    ]);
    const response = await request(calendarAssertion());
    expect(await response.json()).toEqual({ accounts: [], errors: [] });
  });

  it("asks for a reconnect when Dispatch holds no refresh token", async () => {
    getOAuthTokensMock.mockResolvedValue({ access_token: "only-access" });
    const response = await request(calendarAssertion());
    expect(await response.json()).toEqual({
      accounts: [],
      errors: [
        {
          account_email: "work@example.test",
          connection_id: "conn-1",
          error: "no_refresh_token",
          needs_reconnect: true,
        },
      ],
    });
  });

  it("asks for a reconnect when the stored token lacks the provider's scopes", async () => {
    getOAuthTokensMock.mockResolvedValue({
      refresh_token: "refresh-1",
      scope: "https://www.googleapis.com/auth/gmail.modify",
    });
    const response = await request(calendarAssertion());
    const body = await response.json();
    expect(body.errors[0]).toMatchObject({
      error: "missing_scopes",
      needs_reconnect: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a revoked Google grant as needing a reconnect", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    const response = await request(calendarAssertion());
    const body = await response.json();
    expect(body.accounts).toEqual([]);
    expect(body.errors[0]).toMatchObject({
      account_email: "work@example.test",
      error: "invalid_grant",
      needs_reconnect: true,
    });
  });
});
