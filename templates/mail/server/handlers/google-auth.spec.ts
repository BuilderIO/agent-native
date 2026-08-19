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
  getClient: vi.fn(),
  getOAuth2Credentials: vi.fn(),
  getSession: vi.fn(),
  googleFetch: vi.fn(),
  htmlSignatureToMarkdown: vi.fn(),
  isElectron: vi.fn(),
  oauthCallbackResponse: vi.fn(),
  oauthDesktopExchangePage: vi.fn(),
  oauthErrorPage: vi.fn(),
  putUserSetting: vi.fn(),
  readBody: vi.fn(),
  resolveOAuthOwner: vi.fn(),
  resolveOAuthRedirectUri: vi.fn(),
  registerDesktopExchange: vi.fn(),
  safeReturnPath: vi.fn(),
  setAccountDisplayName: vi.fn(),
  setDesktopExchange: vi.fn(),
  setDesktopExchangeError: vi.fn(),
  setOAuthDisplayName: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getHeader: (event: any, name: string) => event.headers?.[name.toLowerCase()],
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
  resolveOAuthOwner: mocks.resolveOAuthOwner,
  resolveOAuthRedirectUri: mocks.resolveOAuthRedirectUri,
  registerDesktopExchange: mocks.registerDesktopExchange,
  safeReturnPath: mocks.safeReturnPath,
  setDesktopExchange: mocks.setDesktopExchange,
  setDesktopExchangeError: mocks.setDesktopExchangeError,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(),
  putUserSetting: mocks.putUserSetting,
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  OAuthAccountOwnedByOtherUserError: class OAuthAccountOwnedByOtherUserError extends Error {
    accountId?: string;
    attemptedOwner?: string;
    existingOwner?: string;
  },
  setOAuthDisplayName: mocks.setOAuthDisplayName,
}));

vi.mock("../lib/google-auth.js", () => ({
  disconnect: mocks.disconnect,
  exchangeCode: mocks.exchangeCode,
  getAuthStatus: mocks.getAuthStatus,
  getAuthUrl: mocks.getAuthUrl,
  getClient: mocks.getClient,
  getOAuth2Credentials: mocks.getOAuth2Credentials,
  setAccountDisplayName: mocks.setAccountDisplayName,
}));

vi.mock("../lib/google-api.js", () => ({
  googleFetch: mocks.googleFetch,
}));

vi.mock("../../shared/gmail-signature.js", () => ({
  htmlSignatureToMarkdown: mocks.htmlSignatureToMarkdown,
}));

const { getGoogleAddAccountUrl, getGoogleAuthUrl, handleGoogleCallback } =
  await import("./google-auth.js");

function createEvent(
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  return { query, headers };
}

describe("Mail Google auth-url handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
    mocks.getSession.mockResolvedValue({ email: "owner@example.com" });
    mocks.getOAuth2Credentials.mockResolvedValue({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
    });
    mocks.getAuthUrl.mockReturnValue(
      "https://accounts.google.com/o/oauth2/v2/auth?state=encoded-state",
    );
    mocks.isElectron.mockReturnValue(false);
    mocks.resolveOAuthRedirectUri.mockReturnValue(
      "https://mail.agent-native.com/_agent-native/google/callback",
    );
    mocks.encodeOAuthState.mockReturnValue("encoded-state");
    mocks.registerDesktopExchange.mockResolvedValue("v".repeat(43));
    mocks.safeReturnPath.mockImplementation((value: string) => value);
  });

  it("returns a native redirect Response for popup sign-in auth URLs", async () => {
    const response = await getGoogleAuthUrl(
      createEvent(
        {
          desktop: "1",
          flow_id: "flow-123",
          redirect: "1",
          return: "/inbox",
        },
        { "x-agent-native-desktop-verifier": "v".repeat(32) },
      ) as any,
    );

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) {
      throw new Error("expected a redirect Response");
    }
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=encoded-state",
    );
    await expect(response.text()).resolves.toBe("");
  });

  it("returns a native redirect Response for add-account auth URLs", async () => {
    const response = await getGoogleAddAccountUrl(
      createEvent(
        {
          desktop: "1",
          flow_id: "flow-456",
          redirect: "1",
        },
        { "x-agent-native-desktop-verifier": "v".repeat(32) },
      ) as any,
    );

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) {
      throw new Error("expected a redirect Response");
    }
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=encoded-state",
    );
    await expect(response.text()).resolves.toBe("");
  });

  it("does not disclose which login owns a conflicting Google account", async () => {
    mocks.decodeOAuthState.mockReturnValue({
      redirectUri:
        "https://mail.agent-native.com/_agent-native/google/callback",
      owner: "second-login@example.com",
    });
    mocks.resolveOAuthOwner.mockResolvedValue({
      owner: "second-login@example.com",
      hasProductionSession: true,
    });
    const conflict = Object.assign(new Error("owned by another user"), {
      name: "OAuthAccountOwnedByOtherUserError",
      accountId: "shared-account@gmail.com",
      existingOwner: "first-login@example.com",
      attemptedOwner: "second-login@example.com",
    });
    mocks.exchangeCode.mockRejectedValue(conflict);

    await handleGoogleCallback(
      createEvent({ code: "google-code", state: "encoded-state" }) as any,
    );

    expect(mocks.oauthErrorPage).toHaveBeenCalledTimes(1);
    const [message] = mocks.oauthErrorPage.mock.calls[0];
    expect(message).toContain("already connected to another login");
    expect(message).not.toContain("first-login@example.com");
    expect(message).not.toContain("second-login@example.com");
  });
});
