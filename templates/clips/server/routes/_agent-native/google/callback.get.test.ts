import { beforeEach, describe, expect, it, vi } from "vitest";

const putSetting = vi.hoisted(() => vi.fn());
const getQuery = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  createOAuthSession: vi.fn(),
  decodeOAuthState: vi.fn(),
  ensureGoogleAuthIdentity: vi.fn(),
  getAppUrl: vi.fn(),
  logOAuthStateDecodeFailure: vi.fn(),
  matchesDesktopOAuthBrowserBinding: vi.fn(),
  oauthCallbackResponse: vi.fn(),
  oauthErrorPage: vi.fn(),
  resolveGoogleSignInCredentials: vi.fn(),
  resolveOAuthOwner: vi.fn(),
  setDesktopExchange: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => ({ putSetting }));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery,
  setResponseStatus: vi.fn(),
}));

vi.mock("../../../lib/google-calendar-client.js", () => ({
  GOOGLE_TOKEN_URL: "https://example.com/token",
  GOOGLE_USERINFO_URL: "https://example.com/userinfo",
}));

vi.mock("../../../lib/google-calendar-oauth.js", () => ({
  handleGoogleCalendarCallback: vi.fn(),
  isCalendarConnectState: vi.fn(() => false),
}));

const { default: callbackHandler, persistGoogleProfileImage } =
  await import("./callback.get.js");

describe("persistGoogleProfileImage", () => {
  beforeEach(() => {
    putSetting.mockReset();
    putSetting.mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  it("stores a non-empty Google profile image under the email avatar key", async () => {
    await persistGoogleProfileImage(
      "vishwas@example.com",
      "https://lh3.googleusercontent.com/a/avatar.jpg",
    );

    expect(putSetting).toHaveBeenCalledWith("avatar:vishwas@example.com", {
      image: "https://lh3.googleusercontent.com/a/avatar.jpg",
    });
  });

  it.each([
    "",
    "not-a-url",
    "http://lh3.googleusercontent.com/avatar.jpg",
    "data:image/png;base64,abc",
    "javascript:alert(1)",
    "https://googleusercontent.com.evil.example/avatar.jpg",
  ])("ignores an unsafe Google profile image URL: %s", async (picture) => {
    await persistGoogleProfileImage("vishwas@example.com", picture);

    expect(putSetting).not.toHaveBeenCalled();
  });

  it("keeps sign-in non-fatal when avatar storage fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    putSetting.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(
      persistGoogleProfileImage(
        "logan@example.com",
        "https://lh3.googleusercontent.com/a/avatar.jpg",
      ),
    ).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(
      "[auth] failed to store Google profile image:",
      expect.any(Error),
    );
  });

  it("passes the canonical new-user result into Google signup tracking", async () => {
    const core = await import("@agent-native/core/server");
    vi.mocked(core.decodeOAuthState).mockReturnValue({
      ok: true,
      redirectUri:
        "https://clips.agent-native.com/_agent-native/google/callback",
    } as never);
    vi.mocked(core.resolveGoogleSignInCredentials).mockReturnValue({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    vi.mocked(core.resolveOAuthOwner).mockResolvedValue({
      owner: undefined,
      hasProductionSession: false,
    });
    vi.mocked(core.ensureGoogleAuthIdentity).mockResolvedValue(true);
    vi.mocked(core.createOAuthSession).mockResolvedValue({
      sessionToken: "session-token",
    } as never);
    vi.mocked(core.oauthCallbackResponse).mockReturnValue("ok" as never);
    getQuery.mockReturnValue({ code: "google-code", state: "encoded-state" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: "token" }))
        .mockResolvedValueOnce(
          Response.json({
            email: "new-user@example.com",
            id: "google-user-1",
            name: "New User",
            picture: "https://lh3.googleusercontent.com/a/avatar.jpg",
            verified_email: true,
          }),
        ),
    );

    await expect(callbackHandler({} as never)).resolves.toBe("ok");

    expect(core.createOAuthSession).toHaveBeenCalledWith(
      {},
      "new-user@example.com",
      expect.objectContaining({
        trackSignup: expect.objectContaining({ isNewUser: true }),
      }),
    );
  });
});
