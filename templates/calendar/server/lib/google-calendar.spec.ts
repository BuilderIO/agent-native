import { beforeEach, describe, expect, it, vi } from "vitest";

const getOAuthAccountsMock = vi.hoisted(() => vi.fn());
const saveOAuthTokensMock = vi.hoisted(() => vi.fn());
const deleteOAuthTokensMock = vi.hoisted(() => vi.fn());
const createOAuth2ClientMock = vi.hoisted(() => vi.fn());
const oauth2GetUserInfoMock = vi.hoisted(() => vi.fn());
const peopleGetProfileMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getOAuthAccounts: getOAuthAccountsMock,
  isOAuthConnected: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  getOAuthTokens: vi.fn(),
  saveOAuthTokens: saveOAuthTokensMock,
  deleteOAuthTokens: deleteOAuthTokensMock,
  listOAuthAccountsByOwner: vi.fn(),
  hasOAuthTokens: vi.fn(),
}));

vi.mock("./google-api.js", () => ({
  createOAuth2Client: createOAuth2ClientMock,
  oauth2GetUserInfo: oauth2GetUserInfoMock,
  peopleGetProfile: peopleGetProfileMock,
  calendarListEvents: vi.fn(),
  calendarGetEvent: vi.fn(),
  calendarInsertEvent: vi.fn(),
  calendarDeleteEvent: vi.fn(),
  calendarPatchEvent: vi.fn(),
}));

import { exchangeCode, getAuthStatus } from "./google-calendar";

describe("calendar Google auth status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    getOAuthAccountsMock.mockResolvedValue([
      {
        accountId: "steve@example.com",
        tokens: {
          access_token: "access-token",
          expiry_date: Date.now() + 10 * 60_000,
        },
      },
    ]);
  });

  it("uses the OAuth userinfo picture for account avatars", async () => {
    oauth2GetUserInfoMock.mockResolvedValue({
      email: "steve@example.com",
      picture: "https://lh3.googleusercontent.com/a/photo",
    });

    const status = await getAuthStatus("steve@example.com");

    expect(status.accounts[0]?.photoUrl).toBe(
      "https://lh3.googleusercontent.com/a/photo",
    );
    expect(peopleGetProfileMock).not.toHaveBeenCalled();
  });

  it("falls back to People API photos when userinfo has no picture", async () => {
    oauth2GetUserInfoMock.mockResolvedValue({ email: "steve@example.com" });
    peopleGetProfileMock.mockResolvedValue({
      photos: [
        { url: "https://example.com/default.png", default: true },
        { url: "https://example.com/profile.png", default: false },
      ],
    });

    const status = await getAuthStatus("steve@example.com");

    expect(status.accounts[0]?.photoUrl).toBe(
      "https://example.com/profile.png",
    );
  });

  it("keeps the owner when refreshing an added account during status lookup", async () => {
    getOAuthAccountsMock.mockResolvedValue([
      {
        accountId: "secondary@example.com",
        tokens: {
          access_token: "old-token",
          refresh_token: "refresh-token",
          expiry_date: Date.now() - 60_000,
        },
      },
    ]);
    createOAuth2ClientMock.mockReturnValue({
      refreshToken: vi.fn().mockResolvedValue({
        access_token: "new-token",
        expiry_date: Date.now() + 60_000,
      }),
    });
    oauth2GetUserInfoMock.mockResolvedValue({
      email: "secondary@example.com",
      picture: "https://example.com/secondary.png",
    });

    await getAuthStatus("owner@example.com");

    expect(saveOAuthTokensMock).toHaveBeenCalledWith(
      "google",
      "secondary@example.com",
      expect.objectContaining({ access_token: "new-token" }),
      "owner@example.com",
    );
  });
});

describe("calendar Google OAuth exchange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  });

  it("stores the Google profile picture captured during OAuth", async () => {
    createOAuth2ClientMock.mockReturnValue({
      getToken: vi.fn().mockResolvedValue({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "scope",
      }),
    });
    oauth2GetUserInfoMock.mockResolvedValue({
      email: "steve@example.com",
      picture: "https://lh3.googleusercontent.com/a/photo",
    });

    await exchangeCode(
      "oauth-code",
      undefined,
      "https://app.example.com/_agent-native/google/callback",
      "owner@example.com",
    );

    expect(saveOAuthTokensMock).toHaveBeenCalledWith(
      "google",
      "steve@example.com",
      expect.objectContaining({
        access_token: "access-token",
        photoUrl: "https://lh3.googleusercontent.com/a/photo",
      }),
      "owner@example.com",
    );
  });
});
