import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOAuthSession: vi.fn(),
  decodeOAuthState: vi.fn(),
  disconnect: vi.fn(),
  encodeOAuthState: vi.fn(),
  exchangeCode: vi.fn(),
  getAppUrl: vi.fn(),
  getAuthStatus: vi.fn(),
  getAuthUrl: vi.fn(),
  getSession: vi.fn(),
  isElectron: vi.fn(),
  oauthCallbackResponse: vi.fn(),
  oauthDesktopExchangePage: vi.fn(),
  oauthErrorPage: vi.fn(),
  readBody: vi.fn(),
  resolveOAuthOwner: vi.fn(),
  resolveOAuthRedirectUri: vi.fn(),
  resolveSecret: vi.fn(),
  runWithRequestContext: vi.fn(),
  safeReturnPath: vi.fn(),
  setDesktopExchange: vi.fn(),
  setDesktopExchangeError: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getQuery: (event: any) => event.query ?? {},
  setResponseStatus: mocks.setResponseStatus,
}));

vi.mock("@agent-native/core/server", () => ({
  createOAuthSession: mocks.createOAuthSession,
  decodeOAuthState: mocks.decodeOAuthState,
  encodeOAuthState: mocks.encodeOAuthState,
  getAppUrl: mocks.getAppUrl,
  getSession: mocks.getSession,
  isElectron: mocks.isElectron,
  oauthCallbackResponse: mocks.oauthCallbackResponse,
  oauthDesktopExchangePage: mocks.oauthDesktopExchangePage,
  oauthErrorPage: mocks.oauthErrorPage,
  readBody: mocks.readBody,
  resolveGoogleSignInCredentials: () => {
    const clientId = process.env.GOOGLE_SIGN_IN_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_SIGN_IN_CLIENT_SECRET;
    if (clientId && clientSecret) return { clientId, clientSecret };
    const fallbackClientId = process.env.GOOGLE_CLIENT_ID;
    const fallbackClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    return fallbackClientId && fallbackClientSecret
      ? { clientId: fallbackClientId, clientSecret: fallbackClientSecret }
      : null;
  },
  resolveOAuthOwner: mocks.resolveOAuthOwner,
  resolveOAuthRedirectUri: mocks.resolveOAuthRedirectUri,
  resolveSecret: mocks.resolveSecret,
  runWithRequestContext: mocks.runWithRequestContext,
  safeReturnPath: mocks.safeReturnPath,
  setDesktopExchange: mocks.setDesktopExchange,
  setDesktopExchangeError: mocks.setDesktopExchangeError,
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  OAuthAccountOwnedByOtherUserError: class OAuthAccountOwnedByOtherUserError extends Error {
    accountId?: string;
    attemptedOwner?: string;
    existingOwner?: string;
  },
}));

vi.mock("../lib/google-calendar.js", () => ({
  disconnect: mocks.disconnect,
  exchangeCode: mocks.exchangeCode,
  getAuthStatus: mocks.getAuthStatus,
  getAuthUrl: mocks.getAuthUrl,
}));

const {
  getGoogleAuthUrl,
  handleGoogleAddAccountCallback,
  handleGoogleCallback,
} = await import("./google-auth.js");

function createEvent(query: Record<string, string> = {}) {
  return { query };
}

describe("Calendar Google auth-url handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_SIGN_IN_CLIENT_ID", "sign-in-client-id");
    vi.stubEnv("GOOGLE_SIGN_IN_CLIENT_SECRET", "sign-in-client-secret");
    vi.stubEnv("GOOGLE_CLIENT_ID", "calendar-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "calendar-client-secret");
    mocks.getAuthUrl.mockReturnValue(
      "https://accounts.google.com/o/oauth2/v2/auth?scope=calendar&state=encoded-state",
    );
    mocks.isElectron.mockReturnValue(false);
    mocks.resolveOAuthRedirectUri.mockReturnValue(
      "https://calendar.agent-native.com/_agent-native/google/callback",
    );
    mocks.resolveSecret.mockImplementation(async (key: string) => {
      if (key === "GOOGLE_CLIENT_ID") return "calendar-client-id";
      if (key === "GOOGLE_CLIENT_SECRET") return "calendar-client-secret";
      return null;
    });
    mocks.runWithRequestContext.mockImplementation(
      (_context: unknown, callback: () => unknown) => callback(),
    );
    mocks.encodeOAuthState.mockReturnValue("encoded-state");
    mocks.createOAuthSession.mockResolvedValue({
      sessionToken: "owner-session-token",
    });
    mocks.safeReturnPath.mockImplementation((value: string) => value);
  });

  it("uses low-scope Google sign-in credentials when no user is signed in", async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await getGoogleAuthUrl(createEvent() as any);

    expect(mocks.getAuthUrl).not.toHaveBeenCalled();
    expect(mocks.encodeOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({
        addAccount: false,
        owner: undefined,
      }),
    );
    expect(result).toEqual({ url: expect.any(String) });

    const url = new URL((result as { url: string }).url);
    expect(url.searchParams.get("client_id")).toBe("sign-in-client-id");
    expect(url.searchParams.get("access_type")).toBe("online");
    expect(url.searchParams.get("prompt")).toBe("select_account");

    const scopes = url.searchParams.get("scope") ?? "";
    expect(scopes).toContain("openid");
    expect(scopes).toContain("https://www.googleapis.com/auth/userinfo.email");
    expect(scopes).not.toContain(
      "https://www.googleapis.com/auth/calendar.events",
    );
    expect(scopes).not.toContain(
      "https://www.googleapis.com/auth/directory.readonly",
    );
  });

  it("uses Calendar API credentials when a signed-in user connects Google Calendar", async () => {
    mocks.getSession.mockResolvedValue({
      email: "owner@example.com",
      orgId: "org-123",
    });

    const result = await getGoogleAuthUrl(createEvent() as any);

    expect(mocks.encodeOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({
        addAccount: true,
        owner: "owner@example.com",
        orgId: "org-123",
      }),
    );
    expect(mocks.getAuthUrl).toHaveBeenCalledWith(
      undefined,
      "https://calendar.agent-native.com/_agent-native/google/callback",
      "encoded-state",
      "owner@example.com",
      "org-123",
    );
    expect(result).toEqual({
      url: "https://accounts.google.com/o/oauth2/v2/auth?scope=calendar&state=encoded-state",
    });
  });

  it("publishes a desktop exchange for Calendar connect without switching away from the owner", async () => {
    const event = createEvent({
      code: "google-code",
      state: "encoded-state",
    });
    mocks.decodeOAuthState.mockReturnValue({
      redirectUri:
        "https://calendar.agent-native.com/_agent-native/google/callback",
      owner: "owner@example.com",
      orgId: "org-123",
      desktop: true,
      addAccount: true,
      flowId: "flow-123",
    });
    mocks.resolveOAuthOwner.mockResolvedValue({
      owner: "owner@example.com",
      hasProductionSession: false,
    });
    mocks.exchangeCode.mockResolvedValue("steve@builder.io");
    mocks.oauthCallbackResponse.mockReturnValue("ok");

    const result = await handleGoogleCallback(event as any);

    expect(result).toBe("ok");
    expect(mocks.exchangeCode).toHaveBeenCalledWith(
      "google-code",
      undefined,
      "https://calendar.agent-native.com/_agent-native/google/callback",
      "owner@example.com",
      "org-123",
    );
    expect(mocks.createOAuthSession).toHaveBeenCalledWith(
      event,
      "owner@example.com",
      {
        hasProductionSession: false,
        desktop: true,
      },
    );
    expect(mocks.setDesktopExchange).toHaveBeenCalledWith(
      "flow-123",
      "owner-session-token",
      "owner@example.com",
    );
    expect(mocks.oauthCallbackResponse).toHaveBeenCalledWith(
      event,
      "steve@builder.io",
      expect.objectContaining({
        sessionToken: "owner-session-token",
        desktop: true,
        addAccount: true,
        flowId: "flow-123",
      }),
    );
  });

  it("publishes a desktop exchange for explicit add-account callbacks", async () => {
    const event = createEvent({
      code: "google-code",
      state: "encoded-state",
    });
    mocks.getSession.mockResolvedValue(null);
    mocks.decodeOAuthState.mockReturnValue({
      redirectUri:
        "https://calendar.agent-native.com/_agent-native/google/add-account/callback",
      owner: "owner@example.com",
      orgId: "org-123",
      desktop: true,
      flowId: "flow-456",
    });
    mocks.exchangeCode.mockResolvedValue("secondary@example.com");
    mocks.oauthCallbackResponse.mockReturnValue("ok");

    const result = await handleGoogleAddAccountCallback(event as any);

    expect(result).toBe("ok");
    expect(mocks.exchangeCode).toHaveBeenCalledWith(
      "google-code",
      undefined,
      "https://calendar.agent-native.com/_agent-native/google/add-account/callback",
      "owner@example.com",
      "org-123",
    );
    expect(mocks.createOAuthSession).toHaveBeenCalledWith(
      event,
      "owner@example.com",
      {
        hasProductionSession: false,
        desktop: true,
      },
    );
    expect(mocks.setDesktopExchange).toHaveBeenCalledWith(
      "flow-456",
      "owner-session-token",
      "owner@example.com",
    );
    expect(mocks.oauthCallbackResponse).toHaveBeenCalledWith(
      event,
      "secondary@example.com",
      expect.objectContaining({
        sessionToken: "owner-session-token",
        desktop: true,
        addAccount: true,
        flowId: "flow-456",
      }),
    );
  });
});
