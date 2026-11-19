import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  state: {} as Record<string, unknown>,
  bind: vi.fn(),
  encode: vi.fn(() => "signed-state"),
  identity: vi.fn(),
  session: vi.fn(),
  currentSession: vi.fn(),
  calendar: vi.fn(),
}));
vi.mock("@agent-native/core/server", () => ({
  encodeOAuthState: mocks.encode,
  decodeOAuthState: () => ({ ok: true, ...mocks.state }),
  getSession: mocks.currentSession,
  isElectron: () => false,
  resolveGoogleSignInCredentials: () => ({
    clientId: "test",
    clientSecret: "test",
  }),
  resolveOAuthRedirectUri: () =>
    "https://clips.test/_agent-native/google/callback",
  wrapNetlifyPreviewGoogleOAuthState: (_event: unknown, state: string) => state,
  registerDesktopExchange: vi.fn(),
  prepareDesktopOAuthBrowserBinding: vi.fn(),
  safeReturnPath: (path: string) => path,
  createOAuthSession: mocks.session,
  recordBuilderSignupBinding: mocks.bind,
  ensureGoogleAuthIdentity: mocks.identity,
  getAppUrl: () => "https://clips.test/_agent-native/google/callback",
  logOAuthStateDecodeFailure: vi.fn(),
  oauthCallbackResponse: () => ({ signedIn: true }),
  oauthErrorPage: (message: string) => ({ error: message }),
  resolveOAuthOwner: async () => ({ hasProductionSession: false }),
  matchesDesktopOAuthBrowserBinding: () => true,
  setDesktopExchange: vi.fn(),
}));
vi.mock("@agent-native/core/settings", () => ({ putSetting: vi.fn() }));
vi.mock("@agent-native/core/shared", () => ({
  isGoogleProfileImageUrl: () => false,
}));
vi.mock("h3", () => ({
  defineEventHandler: (fn: unknown) => fn,
  getQuery: () => mocks.query,
  getHeader: vi.fn(),
  getMethod: () => "GET",
  setResponseStatus: vi.fn(),
}));
vi.mock("../../../lib/google-calendar-client.js", () => ({
  GOOGLE_AUTH_URL: "https://accounts.google.com/o/oauth2/v2/auth",
  GOOGLE_CALENDAR_SCOPES: ["calendar"],
  GOOGLE_TOKEN_URL: "https://oauth2.googleapis.com/token",
  GOOGLE_USERINFO_URL: "https://www.googleapis.com/oauth2/v2/userinfo",
  resolveGoogleOAuthCredentialCandidates: async () => [
    { clientId: "calendar", clientSecret: "test" },
  ],
}));
vi.mock("../../../lib/google-calendar-oauth.js", () => ({
  CLIPS_GOOGLE_OAUTH_APP_ID: "clips",
  isCalendarConnectState: (state: Record<string, unknown>) =>
    state.addAccount === true,
  handleGoogleCalendarCallback: mocks.calendar,
}));
import authUrl from "./auth-url.get";
import callback from "./callback.get";

describe("Clips Google signup experiment binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query = {};
    mocks.state = {};
    mocks.currentSession.mockResolvedValue(null);
    mocks.identity.mockResolvedValue(true);
    mocks.session.mockResolvedValue({ sessionToken: "issued-test-session" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "test" }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            email: "qa@example.com",
            verified_email: true,
            id: "google-test",
            name: "QA",
          }),
        }),
    );
  });
  it("carries a bounded signup attempt in signed Google state", async () => {
    mocks.query = { builder_signup_attempt: "a".repeat(150) };
    await authUrl({} as never);
    expect(mocks.encode).toHaveBeenCalledWith(
      expect.objectContaining({ builderSignupAttemptId: "a".repeat(128) }),
    );
  });
  it("does not bind calendar connection state to signup", async () => {
    mocks.query = { calendar: "1", builder_signup_attempt: "attempt" };
    mocks.currentSession.mockResolvedValue({ email: "qa@example.com" });
    await authUrl({} as never);
    expect(mocks.encode).toHaveBeenCalledWith(
      expect.objectContaining({ builderSignupAttemptId: undefined }),
    );
    mocks.state = { addAccount: true, builderSignupAttemptId: "attempt" };
    await callback({} as never);
    expect(mocks.calendar).toHaveBeenCalled();
    expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("binds a new verified Google identity with the actual issued session", async () => {
    mocks.query = { code: "test-code" };
    mocks.state = {
      builderSignupAttemptId: "attempt",
      redirectUri: "https://clips.test/_agent-native/google/callback",
    };
    const event = {} as never;
    expect(await callback(event)).toEqual({ signedIn: true });
    expect(mocks.bind).toHaveBeenCalledWith(
      event,
      "attempt",
      "google",
      "qa@example.com",
      {
        email: "qa@example.com",
        token: "issued-test-session",
        name: "QA",
        emailVerified: true,
      },
    );
  });
  it("does not enroll an existing Google identity", async () => {
    mocks.query = { code: "test-code" };
    mocks.identity.mockResolvedValue(false);
    await callback({} as never);
    expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("never binds an unverified provider email", async () => {
    mocks.query = { code: "test-code" };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "test" }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            email: "qa@example.com",
            verified_email: false,
            id: "google-test",
          }),
        }),
    );
    await callback({} as never);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.bind).not.toHaveBeenCalled();
  });
});
