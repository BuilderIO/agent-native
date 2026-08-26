import { beforeEach, describe, expect, it, vi } from "vitest";

const putSetting = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  createOAuthSession: vi.fn(),
  decodeOAuthState: vi.fn(),
  getAppUrl: vi.fn(),
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
  getQuery: vi.fn(),
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

import { persistGoogleProfileImage } from "./callback.get.js";

describe("persistGoogleProfileImage", () => {
  beforeEach(() => {
    putSetting.mockReset();
    putSetting.mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  it("stores a non-empty Google profile image under the email avatar key", async () => {
    await persistGoogleProfileImage(
      "vishwas@example.com",
      "https://example.com/avatar.jpg",
    );

    expect(putSetting).toHaveBeenCalledWith("avatar:vishwas@example.com", {
      image: "https://example.com/avatar.jpg",
    });
  });

  it("keeps sign-in non-fatal when avatar storage fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    putSetting.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(
      persistGoogleProfileImage(
        "logan@example.com",
        "https://example.com/avatar.jpg",
      ),
    ).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(
      "[auth] failed to store Google profile image:",
      expect.any(Error),
    );
  });
});
