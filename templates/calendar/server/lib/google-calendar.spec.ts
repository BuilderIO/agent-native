import { beforeEach, describe, expect, it, vi } from "vitest";

const getOAuthAccountsMock = vi.hoisted(() => vi.fn());
const listOAuthAccountsByOwnerMock = vi.hoisted(() => vi.fn());
const saveOAuthTokensMock = vi.hoisted(() => vi.fn());
const deleteOAuthTokensMock = vi.hoisted(() => vi.fn());
const createOAuth2ClientMock = vi.hoisted(() => vi.fn());
const oauth2GetUserInfoMock = vi.hoisted(() => vi.fn());
const peopleGetProfileMock = vi.hoisted(() => vi.fn());
const calendarGetEventMock = vi.hoisted(() => vi.fn());
const calendarFreeBusyMock = vi.hoisted(() => vi.fn());
const calendarPatchEventMock = vi.hoisted(() => vi.fn());
const dbExecuteMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getOAuthAccounts: getOAuthAccountsMock,
  isOAuthConnected: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  getOAuthTokens: vi.fn(),
  saveOAuthTokens: saveOAuthTokensMock,
  deleteOAuthTokens: deleteOAuthTokensMock,
  listOAuthAccountsByOwner: listOAuthAccountsByOwnerMock,
  hasOAuthTokens: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: dbExecuteMock }),
}));

vi.mock("./google-api.js", () => ({
  createOAuth2Client: createOAuth2ClientMock,
  oauth2GetUserInfo: oauth2GetUserInfoMock,
  peopleGetProfile: peopleGetProfileMock,
  calendarListEvents: vi.fn(),
  calendarGetEvent: calendarGetEventMock,
  calendarInsertEvent: vi.fn(),
  calendarDeleteEvent: vi.fn(),
  calendarPatchEvent: calendarPatchEventMock,
  calendarFreeBusy: calendarFreeBusyMock,
}));

import {
  exchangeCode,
  getAuthStatus,
  getFreeBusy,
  getPrimaryAccountPhotoUrl,
  updateEvent,
} from "./google-calendar";

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
    dbExecuteMock.mockResolvedValue({ rows: [] });
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

  it("returns the primary Google account photo for booking OG images", async () => {
    listOAuthAccountsByOwnerMock.mockResolvedValue([
      {
        accountId: "steve@example.com",
        tokens: {
          access_token: "access-token",
          expiry_date: Date.now() + 10 * 60_000,
          photoUrl: "https://lh3.googleusercontent.com/a/photo",
        },
      },
    ]);

    await expect(getPrimaryAccountPhotoUrl("steve@example.com")).resolves.toBe(
      "https://lh3.googleusercontent.com/a/photo",
    );
  });

  it("falls back to Better Auth user image for booking OG images", async () => {
    listOAuthAccountsByOwnerMock.mockResolvedValue([]);
    dbExecuteMock.mockResolvedValue({
      rows: [{ image: "https://lh3.googleusercontent.com/a/auth-photo" }],
    });

    await expect(getPrimaryAccountPhotoUrl("steve@example.com")).resolves.toBe(
      "https://lh3.googleusercontent.com/a/auth-photo",
    );
  });
});

describe("calendar recurring event updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOAuthAccountsByOwnerMock.mockResolvedValue([
      {
        accountId: "steve@example.com",
        tokens: {
          access_token: "access-token",
          expiry_date: Date.now() + 10 * 60_000,
        },
      },
    ]);
    calendarPatchEventMock.mockResolvedValue({
      id: "series-1",
      htmlLink: "https://calendar.google.com/event",
    });
  });

  it("patches the recurring master when updating all events from an occurrence", async () => {
    calendarGetEventMock
      .mockResolvedValueOnce({
        id: "instance-1",
        recurringEventId: "series-1",
        start: { dateTime: "2026-05-20T15:00:00Z" },
        end: { dateTime: "2026-05-20T16:00:00Z" },
      })
      .mockResolvedValueOnce({
        id: "series-1",
        start: { dateTime: "2026-05-06T15:00:00Z" },
        end: { dateTime: "2026-05-06T16:00:00Z" },
      });

    await updateEvent(
      "instance-1",
      {
        accountEmail: "steve@example.com",
        start: "2026-05-20T16:00:00Z",
        end: "2026-05-20T17:00:00Z",
      },
      { scope: "all" },
    );

    expect(calendarPatchEventMock).toHaveBeenCalledWith(
      "access-token",
      "primary",
      "series-1",
      expect.objectContaining({
        start: { dateTime: "2026-05-06T16:00:00Z" },
        end: { dateTime: "2026-05-06T17:00:00Z" },
      }),
      expect.any(Object),
    );
  });
});

describe("calendar free/busy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOAuthAccountsByOwnerMock.mockResolvedValue([
      {
        accountId: "primary@example.com",
        tokens: {
          access_token: "primary-token",
          expiry_date: Date.now() + 10 * 60_000,
        },
      },
      {
        accountId: "secondary@example.com",
        tokens: {
          access_token: "secondary-token",
          expiry_date: Date.now() + 10 * 60_000,
        },
      },
    ]);
    calendarFreeBusyMock.mockResolvedValue({
      calendars: { "secondary@example.com": { busy: [] } },
    });
  });

  it("uses the selected organizer account for free/busy lookup", async () => {
    await getFreeBusy(
      "2026-05-28T16:00:00Z",
      "2026-05-28T18:00:00Z",
      ["secondary@example.com"],
      "owner@example.com",
      "America/Los_Angeles",
      "secondary@example.com",
    );

    expect(calendarFreeBusyMock).toHaveBeenCalledWith(
      "secondary-token",
      expect.objectContaining({
        timeZone: "America/Los_Angeles",
        items: [{ id: "secondary@example.com" }],
      }),
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
