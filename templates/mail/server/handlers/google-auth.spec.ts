import { resolveNativeAuthCopy } from "@agent-native/core/shared";
import type { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOAuthSession: vi.fn(),
  recordBuilderSignupBinding: vi.fn(),
  hasGoogleAuthIdentity: vi.fn(),
  decodeOAuthState: vi.fn(),
  disconnect: vi.fn(),
  encodeOAuthState: vi.fn(),
  ensureGoogleAuthIdentity: vi.fn(),
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
  logOAuthStateDecodeFailure: vi.fn(),
  oauthCallbackResponse: vi.fn(),
  oauthDesktopExchangePage: vi.fn(),
  oauthErrorPage: vi.fn(),
  prepareDesktopOAuthBrowserBinding: vi.fn(),
  putUserSetting: vi.fn(),
  readBody: vi.fn(),
  matchesDesktopOAuthBrowserBinding: vi.fn(),
  resolveOAuthOwner: vi.fn(),
  resolveOAuthRedirectUri: vi.fn(),
  registerDesktopExchange: vi.fn(),
  safeReturnPath: vi.fn(),
  setAccountDisplayName: vi.fn(),
  setDesktopExchange: vi.fn(),
  setDesktopExchangeError: vi.fn(),
  setOAuthDisplayName: vi.fn(),
  setResponseStatus: vi.fn(),
  wrapNetlifyPreviewGoogleOAuthState: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getHeader: (event: any, name: string) => event.headers?.[name.toLowerCase()],
  getMethod: (event: any) => event.method ?? "GET",
  getQuery: (event: any) => event.query ?? {},
  setResponseStatus: mocks.setResponseStatus,
}));

vi.mock("@agent-native/core/server", () => ({
  createOAuthSession: mocks.createOAuthSession,
  recordBuilderSignupBinding: mocks.recordBuilderSignupBinding,
  hasGoogleAuthIdentity: mocks.hasGoogleAuthIdentity,
  decodeOAuthState: mocks.decodeOAuthState,
  encodeOAuthState: mocks.encodeOAuthState,
  ensureGoogleAuthIdentity: mocks.ensureGoogleAuthIdentity,
  getAppUrl: mocks.getAppUrl,
  getSession: mocks.getSession,
  isElectron: mocks.isElectron,
  logOAuthStateDecodeFailure: mocks.logOAuthStateDecodeFailure,
  oauthCallbackResponse: mocks.oauthCallbackResponse,
  oauthDesktopExchangePage: mocks.oauthDesktopExchangePage,
  oauthErrorPage: mocks.oauthErrorPage,
  prepareDesktopOAuthBrowserBinding: mocks.prepareDesktopOAuthBrowserBinding,
  readBody: mocks.readBody,
  matchesDesktopOAuthBrowserBinding: mocks.matchesDesktopOAuthBrowserBinding,
  resolveOAuthOwner: mocks.resolveOAuthOwner,
  resolveOAuthRedirectUri: mocks.resolveOAuthRedirectUri,
  resolveLocaleFromRequest: (options: { acceptLanguage?: string | null }) => ({
    locale: options.acceptLanguage ?? "en-US",
  }),
  registerDesktopExchange: mocks.registerDesktopExchange,
  safeReturnPath: mocks.safeReturnPath,
  setDesktopExchange: mocks.setDesktopExchange,
  setDesktopExchangeError: mocks.setDesktopExchangeError,
  wrapNetlifyPreviewGoogleOAuthState: mocks.wrapNetlifyPreviewGoogleOAuthState,
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
  method = "GET",
) {
  return { query, headers, method };
}

function asEvent(event: ReturnType<typeof createEvent>) {
  return event as unknown as H3Event;
}

describe("Mail Google auth-url handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasGoogleAuthIdentity.mockResolvedValue(false);
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
    mocks.wrapNetlifyPreviewGoogleOAuthState.mockImplementation(
      (_event: unknown, state: string) => state,
    );
    mocks.registerDesktopExchange.mockResolvedValue("v".repeat(43));
    mocks.prepareDesktopOAuthBrowserBinding.mockReturnValue("b".repeat(43));
    mocks.matchesDesktopOAuthBrowserBinding.mockReturnValue(true);
    mocks.safeReturnPath.mockImplementation((value: string) => value);
  });

  it("returns a JSON auth URL for verifier-bound desktop sign-in", async () => {
    const response = await getGoogleAuthUrl(
      createEvent(
        {
          desktop: "1",
          flow_id: "flow-123",
          return: "/inbox",
        },
        { "x-agent-native-desktop-verifier": "v".repeat(32) },
        "POST",
      ) as any,
    );

    expect(response).toEqual({
      url: "https://accounts.google.com/o/oauth2/v2/auth?state=encoded-state",
    });
  });

  it("keeps Gmail-scoped OAuth on the preview relay", async () => {
    mocks.resolveOAuthRedirectUri.mockReturnValue(
      "https://beta.dispatch.agent-native.com/_agent-native/google/callback",
    );
    mocks.wrapNetlifyPreviewGoogleOAuthState.mockReturnValue("relay-state");

    await getGoogleAuthUrl(
      createEvent({ return: "/inbox", redirect: "1" }) as any,
    );

    expect(mocks.encodeOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri:
          "https://beta.dispatch.agent-native.com/_agent-native/google/callback",
      }),
    );
    expect(mocks.wrapNetlifyPreviewGoogleOAuthState).toHaveBeenCalledWith(
      expect.anything(),
      "encoded-state",
    );
    expect(mocks.getAuthUrl).toHaveBeenCalledWith(
      undefined,
      "https://beta.dispatch.agent-native.com/_agent-native/google/callback",
      "relay-state",
      "owner@example.com",
    );
  });

  it("exchanges the first preview sign-in into a Gmail-scoped account", async () => {
    mocks.decodeOAuthState.mockReturnValue({
      ok: true,
      redirectUri:
        "https://beta.dispatch.agent-native.com/_agent-native/google/callback",
      owner: undefined,
      addAccount: false,
    });
    mocks.resolveOAuthOwner.mockResolvedValue({
      owner: undefined,
      hasProductionSession: false,
    });
    mocks.exchangeCode.mockResolvedValue("owner@example.com");
    mocks.createOAuthSession.mockResolvedValue({ sessionToken: "session" });
    mocks.getClient.mockResolvedValue({
      email: "owner@example.com",
      accessToken: "gmail-access-token",
    });
    mocks.googleFetch.mockResolvedValue({ id: "google-user-id" });
    mocks.ensureGoogleAuthIdentity.mockResolvedValue(true);
    mocks.oauthCallbackResponse.mockReturnValue("signed-in");

    await expect(
      handleGoogleCallback(
        asEvent(createEvent({ code: "google-code", state: "inner-state" })),
      ),
    ).resolves.toBe("signed-in");

    expect(mocks.exchangeCode).toHaveBeenCalledWith(
      "google-code",
      undefined,
      "https://beta.dispatch.agent-native.com/_agent-native/google/callback",
      undefined,
    );
    expect(mocks.createOAuthSession).toHaveBeenCalled();
    expect(mocks.getClient).toHaveBeenCalledWith("owner@example.com");
    expect(mocks.createOAuthSession).toHaveBeenCalledWith(
      expect.anything(),
      "owner@example.com",
      expect.objectContaining({
        trackSignup: expect.objectContaining({ isNewUser: true }),
      }),
    );
  });

  it("keeps first-run signaling when optional Google profile lookup fails", async () => {
    mocks.decodeOAuthState.mockReturnValue({
      ok: true,
      redirectUri:
        "https://beta.dispatch.agent-native.com/_agent-native/google/callback",
      owner: undefined,
      addAccount: false,
    });
    mocks.resolveOAuthOwner.mockResolvedValue({
      owner: undefined,
      hasProductionSession: false,
    });
    mocks.exchangeCode.mockResolvedValue("new-user@example.com");
    mocks.getClient.mockRejectedValue(new Error("profile client unavailable"));
    mocks.createOAuthSession.mockResolvedValue({ sessionToken: "session" });
    mocks.oauthCallbackResponse.mockReturnValue("signed-in");

    await expect(
      handleGoogleCallback(
        asEvent(createEvent({ code: "google-code", state: "inner-state" })),
      ),
    ).resolves.toBe("signed-in");

    expect(mocks.createOAuthSession).toHaveBeenCalledWith(
      expect.anything(),
      "new-user@example.com",
      expect.objectContaining({
        trackSignup: { authProvider: "google", isNewUser: undefined },
      }),
    );
    expect(mocks.ensureGoogleAuthIdentity).not.toHaveBeenCalled();
  });

  describe("automatic Builder setup binding", () => {
    const signIn = async (
      profile: Record<string, unknown>,
      isNewUser: boolean,
      builderSignupAttemptId: string | undefined = "attempt-0123456789",
    ) => {
      mocks.decodeOAuthState.mockReturnValue({
        ok: true,
        redirectUri:
          "https://mail.agent-native.com/_agent-native/google/callback",
        owner: undefined,
        addAccount: false,
        builderSignupAttemptId,
      });
      mocks.resolveOAuthOwner.mockResolvedValue({
        owner: undefined,
        hasProductionSession: false,
      });
      mocks.exchangeCode.mockResolvedValue("new@example.com");
      mocks.createOAuthSession.mockResolvedValue({ sessionToken: "session" });
      mocks.getClient.mockResolvedValue({
        email: "new@example.com",
        accessToken: "gmail-access-token",
      });
      mocks.googleFetch.mockResolvedValue(profile);
      mocks.ensureGoogleAuthIdentity.mockResolvedValue(isNewUser);
      mocks.oauthCallbackResponse.mockReturnValue("signed-in");
      await handleGoogleCallback(
        asEvent(createEvent({ code: "google-code", state: "inner-state" })),
      );
    };

    it("binds the signup attempt for a new verified Google identity", async () => {
      await signIn({ id: "google-user-id", verified_email: true }, true);
      expect(mocks.recordBuilderSignupBinding).toHaveBeenCalledWith(
        expect.anything(),
        "attempt-0123456789",
        "google",
        "new@example.com",
        { email: "new@example.com", token: "session", emailVerified: true },
      );
    });

    it("does not bind an existing user signing in again", async () => {
      await signIn({ id: "google-user-id", verified_email: true }, false);
      expect(mocks.recordBuilderSignupBinding).not.toHaveBeenCalled();
    });

    it("does not bind when Google has not verified the email", async () => {
      await signIn({ id: "google-user-id", verified_email: false }, true);
      expect(mocks.recordBuilderSignupBinding).not.toHaveBeenCalled();
    });

    it.each([
      [
        "the profile client fails",
        () => mocks.getClient.mockRejectedValue(new Error("unavailable")),
      ],
      [
        "the profile request fails",
        () => mocks.googleFetch.mockRejectedValue(new Error("unavailable")),
      ],
      [
        "the profile has no account id",
        () => mocks.googleFetch.mockResolvedValue({ verified_email: true }),
      ],
    ])(
      "asks to retry instead of signing in when %s during a signup",
      async (_, fail) => {
        mocks.decodeOAuthState.mockReturnValue({
          ok: true,
          redirectUri:
            "https://mail.agent-native.com/_agent-native/google/callback",
          owner: undefined,
          addAccount: false,
          builderSignupAttemptId: "attempt-0123456789",
        });
        mocks.resolveOAuthOwner.mockResolvedValue({
          owner: undefined,
          hasProductionSession: false,
        });
        mocks.exchangeCode.mockResolvedValue("new@example.com");
        mocks.getClient.mockResolvedValue({
          email: "new@example.com",
          accessToken: "gmail-access-token",
        });
        fail();
        await handleGoogleCallback(
          asEvent(createEvent({ code: "google-code", state: "inner-state" })),
        );
        expect(mocks.createOAuthSession).not.toHaveBeenCalled();
        expect(mocks.recordBuilderSignupBinding).not.toHaveBeenCalled();
        expect(mocks.oauthErrorPage).toHaveBeenCalledWith(
          "We couldn't connect. Please try again.",
        );
      },
    );

    it("still signs in a user already linked to Google when the profile cannot be read", async () => {
      mocks.decodeOAuthState.mockReturnValue({
        ok: true,
        redirectUri:
          "https://mail.agent-native.com/_agent-native/google/callback",
        owner: undefined,
        addAccount: false,
        builderSignupAttemptId: "attempt-0123456789",
      });
      mocks.resolveOAuthOwner.mockResolvedValue({
        owner: undefined,
        hasProductionSession: false,
      });
      mocks.exchangeCode.mockResolvedValue("existing@example.com");
      mocks.getClient.mockRejectedValue(new Error("unavailable"));
      mocks.hasGoogleAuthIdentity.mockResolvedValue(true);
      mocks.createOAuthSession.mockResolvedValue({ sessionToken: "session" });
      mocks.oauthCallbackResponse.mockReturnValue("signed-in");
      await expect(
        handleGoogleCallback(
          asEvent(createEvent({ code: "google-code", state: "inner-state" })),
        ),
      ).resolves.toBe("signed-in");
      expect(mocks.hasGoogleAuthIdentity).toHaveBeenCalledWith(
        "existing@example.com",
      );
      expect(mocks.recordBuilderSignupBinding).not.toHaveBeenCalled();
      expect(mocks.oauthErrorPage).not.toHaveBeenCalled();
    });

    it("asks to retry when the profile and the identity lookup both fail", async () => {
      mocks.decodeOAuthState.mockReturnValue({
        ok: true,
        redirectUri:
          "https://mail.agent-native.com/_agent-native/google/callback",
        owner: undefined,
        addAccount: false,
        builderSignupAttemptId: "attempt-0123456789",
      });
      mocks.resolveOAuthOwner.mockResolvedValue({
        owner: undefined,
        hasProductionSession: false,
      });
      mocks.exchangeCode.mockResolvedValue("new@example.com");
      mocks.getClient.mockRejectedValue(new Error("unavailable"));
      mocks.hasGoogleAuthIdentity.mockRejectedValue(new Error("db down"));
      await handleGoogleCallback(
        asEvent(createEvent({ code: "google-code", state: "inner-state" })),
      );
      expect(mocks.createOAuthSession).not.toHaveBeenCalled();
      expect(mocks.oauthErrorPage).toHaveBeenCalledWith(
        "We couldn't connect. Please try again.",
      );
    });

    it("shows the retry message in the request's language", async () => {
      mocks.decodeOAuthState.mockReturnValue({
        ok: true,
        redirectUri:
          "https://mail.agent-native.com/_agent-native/google/callback",
        owner: undefined,
        addAccount: false,
        builderSignupAttemptId: "attempt-0123456789",
      });
      mocks.resolveOAuthOwner.mockResolvedValue({
        owner: undefined,
        hasProductionSession: false,
      });
      mocks.exchangeCode.mockResolvedValue("new@example.com");
      mocks.getClient.mockRejectedValue(new Error("unavailable"));
      await handleGoogleCallback(
        asEvent(
          createEvent(
            { code: "google-code", state: "inner-state" },
            { "accept-language": "de-DE" },
          ),
        ),
      );
      expect(mocks.oauthErrorPage).toHaveBeenCalledWith(
        resolveNativeAuthCopy("de-DE").failedToConnect,
      );
      expect(resolveNativeAuthCopy("de-DE").failedToConnect).not.toBe(
        resolveNativeAuthCopy("en-US").failedToConnect,
      );
    });

    it("carries the signup attempt into OAuth state", async () => {
      await getGoogleAuthUrl(
        asEvent(createEvent({ builder_signup_attempt: "attempt-0123456789" })),
      );
      expect(mocks.encodeOAuthState).toHaveBeenCalledWith(
        expect.objectContaining({
          builderSignupAttemptId: "attempt-0123456789",
        }),
      );
    });
  });

  it("returns a JSON auth URL for verifier-bound add-account sign-in", async () => {
    const response = await getGoogleAddAccountUrl(
      createEvent(
        {
          desktop: "1",
          flow_id: "flow-456",
        },
        { "x-agent-native-desktop-verifier": "v".repeat(32) },
        "POST",
      ) as any,
    );

    expect(response).toEqual({
      url: "https://accounts.google.com/o/oauth2/v2/auth?state=encoded-state",
    });
  });

  it("rejects a navigated GET even when a verifier header is present", async () => {
    const response = await getGoogleAuthUrl(
      createEvent(
        { desktop: "1", flow_id: "flow-get" },
        { "x-agent-native-desktop-verifier": "v".repeat(32) },
      ) as any,
    );

    expect(response).toEqual({ error: "Invalid desktop exchange challenge." });
    expect(mocks.registerDesktopExchange).not.toHaveBeenCalled();
  });

  it("does not disclose which login owns a conflicting Google account", async () => {
    mocks.decodeOAuthState.mockReturnValue({
      ok: true,
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
    expect(message).toContain("connected to another login");
    expect(message).not.toContain("first-login@example.com");
    expect(message).not.toContain("second-login@example.com");
  });

  it("gives an actionable recovery path for an unverified password account", async () => {
    mocks.decodeOAuthState.mockReturnValue({
      ok: true,
      redirectUri:
        "https://mail.agent-native.com/_agent-native/google/callback",
      owner: "owner@example.com",
    });
    mocks.resolveOAuthOwner.mockResolvedValue({
      owner: "owner@example.com",
      hasProductionSession: true,
    });
    mocks.exchangeCode.mockRejectedValue(
      new Error("Cannot link Google to an unverified email/password identity"),
    );

    await handleGoogleCallback(
      createEvent({ code: "google-code", state: "encoded-state" }) as any,
    );

    const [message] = mocks.oauthErrorPage.mock.calls[0];
    expect(message).toContain("unverified password account");
    expect(message).toContain("Verify that account");
    expect(message).not.toContain("Cannot link Google");
  });

  it("treats scope failures from the primary callback query as missing permissions", async () => {
    mocks.decodeOAuthState.mockReturnValue({
      ok: true,
      redirectUri:
        "https://mail.agent-native.com/_agent-native/google/callback",
      owner: "owner@example.com",
    });
    mocks.getAppUrl.mockReturnValue(
      "https://mail.agent-native.com/_agent-native/google/callback",
    );
    mocks.oauthErrorPage.mockImplementation((message: string) => message);

    const response = await handleGoogleCallback({
      query: {
        error: "forbidden",
        error_description: "Request had insufficient authentication scopes.",
      },
    } as any);

    expect(response).toContain("required permissions");
    expect(response).toContain("Google Cloud Console");
  });

  it("treats 403 scope failures as missing Google permissions", async () => {
    const { handleGoogleAddAccountCallback } = await import("./google-auth.js");
    mocks.getSession.mockResolvedValue({ email: "owner@example.com" });
    mocks.decodeOAuthState.mockReturnValue({
      ok: true,
      redirectUri:
        "https://mail.agent-native.com/_agent-native/google/add-account/callback",
      owner: "owner@example.com",
      desktop: false,
      flowId: undefined,
    });
    mocks.getAppUrl.mockReturnValue(
      "https://mail.agent-native.com/_agent-native/google/add-account/callback",
    );
    mocks.setResponseStatus.mockClear();
    mocks.readBody.mockResolvedValue({});
    mocks.oauthErrorPage.mockImplementation((message: string) => message);

    const response = await handleGoogleAddAccountCallback({
      query: {
        error: "forbidden",
        error_description: "Request had insufficient authentication scopes.",
      },
    } as any);

    expect(response).toContain("required permissions");
    expect(response).toContain("Google Cloud Console");
  });
});
