import { beforeEach, describe, expect, it, vi } from "vitest";

const getOAuthAccountsMock = vi.hoisted(() => vi.fn());
const listOAuthAccountsByOwnerMock = vi.hoisted(() => vi.fn());
const saveOAuthTokensMock = vi.hoisted(() => vi.fn());
const deleteOAuthTokensMock = vi.hoisted(() => vi.fn());
const createOAuth2ClientMock = vi.hoisted(() => vi.fn());
const oauth2GetUserInfoMock = vi.hoisted(() => vi.fn());
const peopleGetProfileMock = vi.hoisted(() => vi.fn());
const calendarGetEventMock = vi.hoisted(() => vi.fn());
const calendarListEventsMock = vi.hoisted(() => vi.fn());
const calendarFreeBusyMock = vi.hoisted(() => vi.fn());
const calendarInsertEventMock = vi.hoisted(() => vi.fn());
const calendarDeleteEventMock = vi.hoisted(() => vi.fn());
const calendarPatchEventMock = vi.hoisted(() => vi.fn());
const dbExecuteMock = vi.hoisted(() => vi.fn());
const resolveSecretMock = vi.hoisted(() => vi.fn());
const runWithRequestContextMock = vi.hoisted(() => vi.fn());
const resolveGoogleProviderCredentialsMock = vi.hoisted(() => vi.fn());
const resolveGoogleLegacyProviderCredentialsMock = vi.hoisted(() => vi.fn());
const getRequestOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getOAuthAccounts: getOAuthAccountsMock,
  getRequestOrgId: getRequestOrgIdMock,
  isOAuthConnected: vi.fn(),
  resolveSecret: resolveSecretMock,
  runWithRequestContext: runWithRequestContextMock,
  resolveGoogleProviderCredentials: resolveGoogleProviderCredentialsMock,
  resolveGoogleLegacyProviderCredentials:
    resolveGoogleLegacyProviderCredentialsMock,
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
  calendarListEvents: calendarListEventsMock,
  calendarGetEvent: calendarGetEventMock,
  calendarInsertEvent: calendarInsertEventMock,
  calendarDeleteEvent: calendarDeleteEventMock,
  calendarPatchEvent: calendarPatchEventMock,
  calendarFreeBusy: calendarFreeBusyMock,
}));

import {
  exchangeCode,
  getAuthUrl,
  getAuthStatus,
  getClientsWithErrors,
  getFreeBusy,
  getPrimaryAccountPhotoUrl,
  createEvent,
  deleteEvent,
  getClientForAccount,
  getDefaultAccountSelection,
  listEvents,
  listOverlayEvents,
  rsvpEvent,
  updateEvent,
} from "./google-calendar";

describe("calendar Google auth status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestOrgIdMock.mockReturnValue(undefined);
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    delete process.env.GOOGLE_LEGACY_CLIENT_ID;
    delete process.env.GOOGLE_LEGACY_CLIENT_SECRET;
    resolveSecretMock.mockImplementation(async (key: string) => {
      const value = process.env[key];
      return typeof value === "string" && value.length > 0 ? value : null;
    });
    resolveGoogleProviderCredentialsMock.mockImplementation(() =>
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }
        : null,
    );
    resolveGoogleLegacyProviderCredentialsMock.mockImplementation(() =>
      process.env.GOOGLE_LEGACY_CLIENT_ID &&
      process.env.GOOGLE_LEGACY_CLIENT_SECRET
        ? {
            clientId: process.env.GOOGLE_LEGACY_CLIENT_ID,
            clientSecret: process.env.GOOGLE_LEGACY_CLIENT_SECRET,
          }
        : null,
    );
    runWithRequestContextMock.mockImplementation(
      (_context: unknown, callback: () => unknown) => callback(),
    );
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

  it("falls back to legacy Google credentials when refreshed tokens were minted by the previous client", async () => {
    process.env.GOOGLE_LEGACY_CLIENT_ID = "legacy-client-id";
    process.env.GOOGLE_LEGACY_CLIENT_SECRET = "legacy-client-secret";
    const primaryRefresh = vi
      .fn()
      .mockRejectedValue(
        new Error("OAuth token refresh failed: unauthorized_client"),
      );
    const legacyRefresh = vi.fn().mockResolvedValue({
      access_token: "legacy-refreshed-token",
      expiry_date: Date.now() + 60_000,
    });
    createOAuth2ClientMock.mockImplementation((clientId: string) => ({
      refreshToken:
        clientId === "legacy-client-id" ? legacyRefresh : primaryRefresh,
    }));
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
    oauth2GetUserInfoMock.mockResolvedValue({
      email: "secondary@example.com",
    });

    await getAuthStatus("owner@example.com");

    expect(primaryRefresh).toHaveBeenCalledWith("refresh-token");
    expect(legacyRefresh).toHaveBeenCalledWith("refresh-token");
    expect(deleteOAuthTokensMock).not.toHaveBeenCalledWith(
      "google",
      "secondary@example.com",
    );
    expect(saveOAuthTokensMock).toHaveBeenCalledWith(
      "google",
      "secondary@example.com",
      expect.objectContaining({ access_token: "legacy-refreshed-token" }),
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

describe("calendar unusable OAuth token records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestOrgIdMock.mockReturnValue(undefined);
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    resolveSecretMock.mockImplementation(async (key: string) => {
      const value = process.env[key];
      return typeof value === "string" && value.length > 0 ? value : null;
    });
    resolveGoogleProviderCredentialsMock.mockImplementation(() =>
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }
        : null,
    );
    resolveGoogleLegacyProviderCredentialsMock.mockReturnValue(null);
    runWithRequestContextMock.mockImplementation(
      (_context: unknown, callback: () => unknown) => callback(),
    );
    dbExecuteMock.mockResolvedValue({ rows: [] });
  });

  it("reports disconnected without deleting the row when a record parses to an empty object", async () => {
    // A stored row that fails to decrypt (key rotation / wrong key) parses to
    // `{}` in core's parseStoredTokens. The account must read as disconnected
    // — but the row must NOT be deleted, because this process may simply hold
    // the wrong key while the row is still decryptable elsewhere.
    getOAuthAccountsMock.mockResolvedValue([
      { accountId: "steve@example.com", tokens: {} },
    ]);

    const status = await getAuthStatus("steve@example.com");

    expect(status.connected).toBe(false);
    expect(status.accounts).toEqual([]);
    expect(deleteOAuthTokensMock).not.toHaveBeenCalled();
    expect(createOAuth2ClientMock).not.toHaveBeenCalled();
  });

  it("surfaces a reconnect error instead of an undefined bearer token", async () => {
    listOAuthAccountsByOwnerMock.mockResolvedValue([
      { accountId: "steve@example.com", tokens: {} },
    ]);

    const { clients, errors } = await getClientsWithErrors("steve@example.com");

    expect(clients).toEqual([]);
    expect(errors).toEqual([
      {
        email: "steve@example.com",
        error: expect.stringContaining("please reconnect"),
      },
    ]);
    expect(deleteOAuthTokensMock).not.toHaveBeenCalled();
  });

  it("refreshes instead of returning undefined when only a refresh token survives", async () => {
    listOAuthAccountsByOwnerMock.mockResolvedValue([
      {
        accountId: "steve@example.com",
        tokens: { refresh_token: "refresh-token" },
      },
    ]);
    createOAuth2ClientMock.mockReturnValue({
      refreshToken: vi.fn().mockResolvedValue({
        access_token: "fresh-token",
        expiry_date: Date.now() + 3_600_000,
      }),
    });

    const { clients, errors } = await getClientsWithErrors("steve@example.com");

    expect(errors).toEqual([]);
    expect(clients).toEqual([
      { email: "steve@example.com", accessToken: "fresh-token" },
    ]);
    expect(saveOAuthTokensMock).toHaveBeenCalledWith(
      "google",
      "steve@example.com",
      expect.objectContaining({ access_token: "fresh-token" }),
      "steve@example.com",
    );
  });
});

describe("calendar event listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calendarListEventsMock.mockReset();
    listOAuthAccountsByOwnerMock.mockResolvedValue([
      {
        accountId: "steve@example.com",
        tokens: {
          access_token: "access-token",
          expiry_date: Date.now() + 10 * 60_000,
        },
      },
    ]);
  });

  it("paginates Google events so broad searches can see later matches", async () => {
    calendarListEventsMock
      .mockResolvedValueOnce({
        items: [
          {
            id: "routine-1",
            summary: "Routine check-in",
            start: { dateTime: "2026-01-05T17:00:00Z" },
            end: { dateTime: "2026-01-05T17:30:00Z" },
          },
        ],
        nextPageToken: "page-2",
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "adobe-1",
            summary: "Adobe Corp Dev",
            start: { dateTime: "2026-02-05T17:00:00Z" },
            end: { dateTime: "2026-02-05T17:30:00Z" },
            attendees: [{ email: "poppy@adobe.com" }],
          },
        ],
      });

    const result = await listEvents(
      "2026-01-01T00:00:00Z",
      "2026-03-01T00:00:00Z",
      "owner@example.com",
    );

    expect(result.events.map((event) => event.googleEventId)).toEqual([
      "routine-1",
      "adobe-1",
    ]);
    expect(calendarListEventsMock).toHaveBeenNthCalledWith(
      1,
      "access-token",
      "primary",
      expect.objectContaining({
        maxResults: 2500,
        pageToken: undefined,
      }),
    );
    expect(calendarListEventsMock).toHaveBeenNthCalledWith(
      2,
      "access-token",
      "primary",
      expect.objectContaining({
        maxResults: 2500,
        pageToken: "page-2",
      }),
    );
  });

  it("preserves attendee details for overlay calendars", async () => {
    calendarListEventsMock.mockResolvedValueOnce({
      items: [
        {
          id: "overlay-1",
          summary: "Design critique",
          start: { dateTime: "2026-02-05T17:00:00Z" },
          end: { dateTime: "2026-02-05T17:30:00Z" },
          attendees: [
            {
              email: "host@example.com",
              displayName: "Host Person",
              organizer: true,
              responseStatus: "accepted",
            },
            {
              email: "guest@example.com",
              displayName: "Guest Person",
              responseStatus: "needsAction",
            },
          ],
          organizer: {
            email: "host@example.com",
            displayName: "Host Person",
          },
        },
      ],
    });

    const result = await listOverlayEvents(
      "2026-02-05T00:00:00Z",
      "2026-02-06T00:00:00Z",
      ["host@example.com"],
      "owner@example.com",
    );

    expect(result.events[0]).toMatchObject({
      id: "overlay-host@example.com-overlay-1",
      overlayEmail: "host@example.com",
      attendees: [
        {
          email: "host@example.com",
          displayName: "Host Person",
          organizer: true,
          responseStatus: "accepted",
        },
        {
          email: "guest@example.com",
          displayName: "Guest Person",
          responseStatus: "needsAction",
        },
      ],
      organizer: {
        email: "host@example.com",
        displayName: "Host Person",
      },
    });
  });
});

describe("calendar event creation", () => {
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
    calendarInsertEventMock.mockResolvedValue({
      id: "event-1",
      htmlLink: "https://calendar.google.com/event",
    });
  });

  it("sends attendee RSVP statuses when creating an event", async () => {
    await createEvent(
      {
        id: "",
        title: "Planning",
        description: "",
        location: "",
        start: "2026-07-09T16:00:00.000Z",
        end: "2026-07-09T16:30:00.000Z",
        allDay: false,
        source: "google",
        accountEmail: "steve@example.com",
        attendees: [
          {
            email: "steve@example.com",
            organizer: true,
            self: true,
            responseStatus: "accepted",
          },
          {
            email: "guest@example.com",
            responseStatus: "needsAction",
          },
        ],
        createdAt: "2026-07-09T15:00:00.000Z",
        updatedAt: "2026-07-09T15:00:00.000Z",
      },
      {
        account: {
          ownerEmail: "steve@example.com",
          accountEmail: "steve@example.com",
        },
      },
    );

    expect(calendarInsertEventMock).toHaveBeenCalledWith(
      "access-token",
      "primary",
      expect.objectContaining({
        attendees: [
          {
            email: "steve@example.com",
            responseStatus: "accepted",
          },
          {
            email: "guest@example.com",
            responseStatus: "needsAction",
          },
        ],
      }),
      undefined,
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
      {
        account: {
          ownerEmail: "steve@example.com",
          accountEmail: "steve@example.com",
        },
        scope: "all",
      },
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

describe("calendar RSVP updates", () => {
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
  });

  it("includes the attendee response note when RSVP-ing", async () => {
    await rsvpEvent(
      "event-1",
      "declined",
      {
        ownerEmail: "steve@example.com",
        accountEmail: "steve@example.com",
      },
      "single",
      "I have a conflict",
    );

    expect(calendarPatchEventMock).toHaveBeenCalledWith(
      "access-token",
      "primary",
      "event-1",
      {
        attendees: [
          {
            email: "steve@example.com",
            responseStatus: "declined",
            comment: "I have a conflict",
          },
        ],
        attendeesOmitted: true,
      },
      { sendUpdates: "none" },
    );
  });

  it("sends an empty comment so an RSVP note can be cleared", async () => {
    await rsvpEvent(
      "event-1",
      "accepted",
      {
        ownerEmail: "steve@example.com",
        accountEmail: "steve@example.com",
      },
      "single",
      "",
    );

    expect(calendarPatchEventMock).toHaveBeenCalledWith(
      "access-token",
      "primary",
      "event-1",
      {
        attendees: [
          {
            email: "steve@example.com",
            responseStatus: "accepted",
            comment: "",
          },
        ],
        attendeesOmitted: true,
      },
      { sendUpdates: "none" },
    );
  });
});

describe("owner-aware Google Calendar writes", () => {
  const ownerEmail = "owner@example.com";
  const secondaryEmail = "secondary@example.com";
  const account = { ownerEmail, accountEmail: secondaryEmail };

  beforeEach(() => {
    vi.clearAllMocks();
    listOAuthAccountsByOwnerMock.mockResolvedValue([
      {
        accountId: ownerEmail,
        tokens: {
          access_token: "owner-access-token",
          expiry_date: Date.now() + 10 * 60_000,
        },
      },
      {
        accountId: secondaryEmail,
        tokens: {
          access_token: "secondary-access-token",
          expiry_date: Date.now() + 10 * 60_000,
        },
      },
    ]);
    calendarInsertEventMock.mockResolvedValue({ id: "event-secondary" });
    calendarPatchEventMock.mockResolvedValue({ id: "event-secondary" });
    calendarDeleteEventMock.mockResolvedValue(undefined);
  });

  it("resolves a secondary account beneath the signed-in owner", async () => {
    await expect(getClientForAccount(account)).resolves.toEqual({
      accessToken: "secondary-access-token",
    });
    expect(listOAuthAccountsByOwnerMock).toHaveBeenCalledWith(
      "google",
      ownerEmail,
    );
  });

  it("keeps legacy owner-scoped callers on the owner's default account", async () => {
    await expect(getDefaultAccountSelection(ownerEmail)).resolves.toEqual({
      ownerEmail,
      accountEmail: ownerEmail,
    });
  });

  it("fails loudly when the selected account is not connected for the owner", async () => {
    await expect(
      getClientForAccount({
        ownerEmail,
        accountEmail: "missing@example.com",
      }),
    ).rejects.toThrow(
      "Google Calendar account not connected for this user: missing@example.com",
    );
  });

  it("routes create, update, delete, and RSVP through the secondary account", async () => {
    const event = {
      id: "",
      title: "Secondary planning",
      description: "",
      location: "",
      start: "2026-07-09T16:00:00.000Z",
      end: "2026-07-09T16:30:00.000Z",
      allDay: false,
      source: "google" as const,
      accountEmail: secondaryEmail,
      createdAt: "2026-07-09T15:00:00.000Z",
      updatedAt: "2026-07-09T15:00:00.000Z",
    };

    await createEvent(event, { account });
    await updateEvent(
      "event-secondary",
      { accountEmail: secondaryEmail, title: "Updated" },
      { account },
    );
    await deleteEvent("event-secondary", account);
    await rsvpEvent("event-secondary", "accepted", account);

    expect(calendarInsertEventMock).toHaveBeenCalledWith(
      "secondary-access-token",
      "primary",
      expect.any(Object),
      undefined,
    );
    expect(calendarPatchEventMock).toHaveBeenCalledWith(
      "secondary-access-token",
      "primary",
      "event-secondary",
      expect.any(Object),
      expect.any(Object),
    );
    expect(calendarDeleteEventMock).toHaveBeenCalledWith(
      "secondary-access-token",
      "primary",
      "event-secondary",
      undefined,
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
    getRequestOrgIdMock.mockReturnValue(undefined);
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    resolveSecretMock.mockImplementation(async (key: string) => {
      const value = process.env[key];
      return typeof value === "string" && value.length > 0 ? value : null;
    });
    runWithRequestContextMock.mockImplementation(
      (_context: unknown, callback: () => unknown) => callback(),
    );
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

  it("resolves Google credentials with the owner org when creating auth URLs", async () => {
    const generateAuthUrl = vi.fn().mockReturnValue("auth-url");
    createOAuth2ClientMock.mockReturnValue({ generateAuthUrl });

    await expect(
      getAuthUrl(
        undefined,
        "https://app.example.com/_agent-native/google/callback",
        "signed-state",
        "owner@example.com",
        "org-123",
      ),
    ).resolves.toBe("auth-url");

    expect(runWithRequestContextMock).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org-123" },
      expect.any(Function),
    );
    expect(createOAuth2ClientMock).toHaveBeenCalledWith(
      "client-id",
      "client-secret",
      "https://app.example.com/_agent-native/google/callback",
    );
  });
});
