import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestTimezoneMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getRequestOrgIdMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const isConnectedMock = vi.hoisted(() => vi.fn());
const getAuthStatusMock = vi.hoisted(() => vi.fn());
const getOwnedAccountEmailsMock = vi.hoisted(() => vi.fn());
const listGoogleEventsMock = vi.hoisted(() => vi.fn());
const listOverlayEventsMock = vi.hoisted(() => vi.fn());
const deleteEventMock = vi.hoisted(() => vi.fn());
const removeEventFromCalendarMock = vi.hoisted(() => vi.fn());
const fetchICalEventsMock = vi.hoisted(() => vi.fn());
const bookingLinkRowsMock = vi.hoisted(() => vi.fn());
const bookingRowsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestTimezone: getRequestTimezoneMock,
  getRequestUserEmail: getRequestUserEmailMock,
  getRequestOrgId: getRequestOrgIdMock,
  signShortLivedToken: vi.fn(() => "token"),
  verifyShortLivedToken: vi.fn(() => ({ ok: true })),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access-filter" })),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  gte: vi.fn((...args: unknown[]) => ({ op: "gte", args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: "inArray", args })),
  lte: vi.fn((...args: unknown[]) => ({ op: "lte", args })),
  ne: vi.fn((...args: unknown[]) => ({ op: "ne", args })),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () =>
          table.__table === "bookings"
            ? bookingRowsMock()
            : bookingLinkRowsMock(),
      }),
    }),
  })),
  schema: {
    bookingLinks: {
      __table: "bookingLinks",
      slug: "slug",
      title: "title",
      color: "color",
    },
    bookingLinkShares: {},
    bookings: {
      __table: "bookings",
      id: "id",
      name: "name",
      email: "email",
      slug: "slug",
      start: "start",
      end: "end",
      eventTitle: "eventTitle",
      notes: "notes",
      meetingLink: "meetingLink",
      googleEventId: "googleEventId",
      status: "status",
      createdAt: "createdAt",
    },
  },
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  isConnected: isConnectedMock,
  getAuthStatus: getAuthStatusMock,
  getOwnedAccountEmails: getOwnedAccountEmailsMock,
  listEvents: listGoogleEventsMock,
  listOverlayEvents: listOverlayEventsMock,
  deleteEvent: deleteEventMock,
  removeEventFromCalendar: removeEventFromCalendarMock,
}));

vi.mock("../server/lib/ical-fetcher.js", () => ({
  fetchICalEvents: fetchICalEventsMock,
}));

import action from "./delete-events";

const OWNER = "owner@example.com";

function googleEvent(
  overrides: Partial<Record<string, unknown>> & { id: string; start: string },
) {
  return {
    title: "Weekend sync",
    description: "",
    end: overrides.start,
    location: "",
    allDay: false,
    source: "google" as const,
    googleEventId: overrides.id,
    accountEmail: OWNER,
    ...overrides,
  };
}

function run(args: Record<string, unknown>) {
  return action.run(args as never, undefined as never) as Promise<
    Record<string, unknown>
  >;
}

describe("delete-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue(OWNER);
    getRequestOrgIdMock.mockReturnValue(undefined);
    getRequestTimezoneMock.mockReturnValue("America/Los_Angeles");
    getUserSettingMock.mockResolvedValue(null);
    isConnectedMock.mockResolvedValue(true);
    getAuthStatusMock.mockResolvedValue({ accounts: [{ email: OWNER }] });
    getOwnedAccountEmailsMock.mockResolvedValue([OWNER]);
    listOverlayEventsMock.mockResolvedValue({
      events: [],
      errors: [],
      accountErrors: [],
    });
    deleteEventMock.mockResolvedValue(undefined);
    removeEventFromCalendarMock.mockResolvedValue(undefined);
    fetchICalEventsMock.mockResolvedValue([]);
    bookingLinkRowsMock.mockResolvedValue([
      { slug: "intro", title: "Intro call", color: "#000" },
    ]);
    bookingRowsMock.mockResolvedValue([]);
  });

  it("deletes weekend events using the calendar timezone, not UTC", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [
        // Sunday 17:00 America/Los_Angeles — Monday in UTC. Filtering the raw
        // ISO string would miss the event the user actually pointed at.
        googleEvent({ id: "sunday-pt", start: "2026-04-13T00:00:00.000Z" }),
        // Saturday 00:00 UTC — still Friday afternoon in America/Los_Angeles.
        googleEvent({ id: "friday-pt", start: "2026-04-11T00:00:00.000Z" }),
        googleEvent({ id: "saturday-pt", start: "2026-04-11T18:00:00.000Z" }),
        googleEvent({ id: "tuesday-pt", start: "2026-04-14T18:00:00.000Z" }),
      ],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: ["saturday", "sunday"],
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(0);
    expect(deleteEventMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      "saturday-pt",
      "sunday-pt",
    ]);
  });

  it("resolves all-day starts from their own date, not a timezone projection", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [
        googleEvent({
          id: "all-day-saturday",
          start: "2026-04-11",
          end: "2026-04-12",
          allDay: true,
        }),
      ],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: "sat",
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.deleted).toBe(1);
    expect(deleteEventMock).toHaveBeenCalledWith(
      "all-day-saturday",
      { ownerEmail: OWNER, accountEmail: OWNER },
      { scope: "single", sendUpdates: "none" },
    );
  });

  it("expands 'weekend' to Saturday and Sunday", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [
        googleEvent({ id: "sat", start: "2026-04-11T18:00:00.000Z" }),
        googleEvent({ id: "sun", start: "2026-04-12T18:00:00.000Z" }),
        googleEvent({ id: "wed", start: "2026-04-15T18:00:00.000Z" }),
      ],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: "weekend",
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.daysOfWeek).toEqual(["sunday", "saturday"]);
    expect(result.deleted).toBe(2);
  });

  it("previews matches without deleting when dryRun is set", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [googleEvent({ id: "sat", start: "2026-04-11T18:00:00.000Z" })],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: ["saturday"],
      dryRun: true,
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.dryRun).toBe(true);
    expect(result.matched).toBe(1);
    expect(result.deleted).toBe(0);
    expect(deleteEventMock).not.toHaveBeenCalled();
    expect(result.events).toEqual([
      expect.objectContaining({
        id: "google-sat",
        weekday: "saturday",
        outcome: "matched",
      }),
    ]);
  });

  it("reports per-event failures instead of rounding them up to success", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [
        googleEvent({ id: "ok", start: "2026-04-11T18:00:00.000Z" }),
        googleEvent({ id: "gone", start: "2026-04-12T18:00:00.000Z" }),
      ],
      errors: [],
    });
    deleteEventMock.mockImplementation(async (id: string) => {
      if (id === "gone") throw new Error("404 Not Found");
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: "weekend",
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "google-gone",
          outcome: "failed",
          reason: "404 Not Found",
        }),
      ]),
    );
  });

  it("refuses to delete from an incomplete provider read", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [googleEvent({ id: "sat", start: "2026-04-11T18:00:00.000Z" })],
      errors: [{ email: "second@example.com", error: "token expired" }],
    });

    await expect(
      run({
        from: "2026-04-06",
        to: "2026-04-20",
        daysOfWeek: "weekend",
        scope: "single",
        sendUpdates: "none",
      }),
    ).rejects.toThrow(/incomplete calendar read/i);
    expect(deleteEventMock).not.toHaveBeenCalled();
  });

  it("reports a read-only ICS weekend event instead of leaving it out", async () => {
    getUserSettingMock.mockImplementation(async (_email, key) =>
      key === "external-calendars"
        ? [
            {
              id: "feed-1",
              name: "Team offsites",
              url: "https://example.com/skip.ics",
              color: "#000",
            },
          ]
        : null,
    );
    fetchICalEventsMock.mockResolvedValue([
      {
        id: "ics-sat",
        title: "Offsite",
        description: "",
        start: "2026-04-11T18:00:00.000Z",
        end: "2026-04-11T19:00:00.000Z",
        location: "",
        allDay: false,
        source: "ical",
        sourceId: "feed-1",
      },
    ]);
    listGoogleEventsMock.mockResolvedValue({
      events: [googleEvent({ id: "mine", start: "2026-04-12T18:00:00.000Z" })],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: "weekend",
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.deleted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.matched).toBe(2);
    expect(deleteEventMock).toHaveBeenCalledTimes(1);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "skipped",
          reason: expect.stringMatching(/read-only/i),
        }),
      ]),
    );
  });

  it("names an ICS feed it could not read so the report is not passed off as complete", async () => {
    getUserSettingMock.mockImplementation(async (_email, key) =>
      key === "external-calendars"
        ? [
            {
              id: "feed-2",
              name: "Broken feed",
              url: "https://example.com/broken.ics",
              color: "#000",
            },
          ]
        : null,
    );
    fetchICalEventsMock.mockRejectedValue(new Error("503 unavailable"));
    listGoogleEventsMock.mockResolvedValue({
      events: [googleEvent({ id: "sat", start: "2026-04-11T18:00:00.000Z" })],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: "saturday",
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.deleted).toBe(1);
    expect(result.unreadableSources).toEqual([
      { name: "Broken feed", error: "503 unavailable" },
    ]);
  });

  it("deletes an explicit id list in one call", async () => {
    const result = await run({
      ids: ["google-a", "b"],
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.deleted).toBe(2);
    expect(deleteEventMock.mock.calls.map((call) => call[0])).toEqual([
      "a",
      "b",
    ]);
    expect(listGoogleEventsMock).not.toHaveBeenCalled();
  });

  it("removes rather than cancels when removeOnly is set", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [googleEvent({ id: "sat", start: "2026-04-11T18:00:00.000Z" })],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: "saturday",
      removeOnly: true,
      scope: "single",
      sendUpdates: "all",
    });

    expect(result.deleted).toBe(1);
    expect(deleteEventMock).not.toHaveBeenCalled();
    expect(removeEventFromCalendarMock).toHaveBeenCalledWith(
      "sat",
      { ownerEmail: OWNER, accountEmail: OWNER },
      { scope: "single", sendUpdates: "none" },
    );
  });

  it("rejects an unrecognized day name instead of ignoring it", async () => {
    await expect(
      run({
        from: "2026-04-06",
        to: "2026-04-20",
        daysOfWeek: "satrday",
        scope: "single",
        sendUpdates: "none",
      }),
    ).rejects.toThrow(/unrecognized day of week/i);
    expect(listGoogleEventsMock).not.toHaveBeenCalled();
  });

  it("requires a range or explicit ids", async () => {
    await expect(
      run({ daysOfWeek: "weekend", scope: "single", sendUpdates: "none" }),
    ).rejects.toThrow(/both from and to/i);
  });

  it("refuses a whole-series scope on a filtered selection", async () => {
    for (const scope of ["all", "thisAndFollowing"]) {
      await expect(
        run({
          from: "2026-04-06",
          to: "2026-04-20",
          daysOfWeek: "weekend",
          scope,
          sendUpdates: "none",
        }),
      ).rejects.toThrow(/whole recurring series/i);
    }
    expect(listGoogleEventsMock).not.toHaveBeenCalled();
    expect(deleteEventMock).not.toHaveBeenCalled();
  });

  it("still allows a whole-series scope for an explicitly named event", async () => {
    const result = await run({
      ids: ["google-series-instance"],
      scope: "all",
      sendUpdates: "none",
    });

    expect(result.deleted).toBe(1);
    expect(deleteEventMock).toHaveBeenCalledWith(
      "series-instance",
      { ownerEmail: OWNER, accountEmail: OWNER },
      { scope: "all", sendUpdates: "none" },
    );
  });

  it("requires both range bounds so a one-sided request cannot widen the delete", async () => {
    await expect(
      run({
        to: "2027-01-01",
        daysOfWeek: "weekend",
        scope: "single",
        sendUpdates: "none",
      }),
    ).rejects.toThrow(/both from and to/i);
    await expect(
      run({
        from: "2026-04-06",
        daysOfWeek: "weekend",
        scope: "single",
        sendUpdates: "none",
      }),
    ).rejects.toThrow(/both from and to/i);
    expect(listGoogleEventsMock).not.toHaveBeenCalled();
  });

  it("keeps the Google event of an active booking and says to cancel the booking", async () => {
    bookingRowsMock.mockResolvedValue([
      {
        id: "bk1",
        name: "Ada",
        email: "ada@example.com",
        slug: "intro",
        start: "2026-04-11T18:00:00.000Z",
        end: "2026-04-11T18:30:00.000Z",
        eventTitle: "Intro call",
        notes: "",
        meetingLink: "",
        googleEventId: "linked-sat",
        status: "confirmed",
        createdAt: "2026-04-01T00:00:00.000Z",
      },
    ]);
    listGoogleEventsMock.mockResolvedValue({
      events: [
        googleEvent({ id: "linked-sat", start: "2026-04-11T18:00:00.000Z" }),
        googleEvent({ id: "plain-sat", start: "2026-04-11T19:00:00.000Z" }),
      ],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: "saturday",
      scope: "single",
      sendUpdates: "none",
    });

    expect(deleteEventMock.mock.calls.map((call) => call[0])).toEqual([
      "plain-sat",
    ]);
    expect(result.deleted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "google-linked-sat",
          outcome: "skipped",
          reason: expect.stringMatching(/cancel the booking/i),
        }),
      ]),
    );
  });

  it("treats the end bound as exclusive for timed and all-day starts", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [
        // Local midnight of the exclusive end date, timed and all-day.
        googleEvent({ id: "timed-at-end", start: "2026-04-18T07:00:00.000Z" }),
        googleEvent({
          id: "allday-at-end",
          start: "2026-04-18",
          end: "2026-04-19",
          allDay: true,
        }),
        googleEvent({ id: "inside", start: "2026-04-11T18:00:00.000Z" }),
      ],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-18",
      daysOfWeek: "saturday",
      scope: "single",
      sendUpdates: "none",
    });

    expect(deleteEventMock.mock.calls.map((call) => call[0])).toEqual([
      "inside",
    ]);
    expect(result.deleted).toBe(1);
  });

  it("prefers the pinned calendar timezone over the browser timezone", async () => {
    getRequestTimezoneMock.mockReturnValue("UTC");
    getUserSettingMock.mockImplementation(async (_email, key) =>
      key === "calendar-settings" ? { timezone: "America/Los_Angeles" } : null,
    );
    listGoogleEventsMock.mockResolvedValue({
      events: [
        googleEvent({ id: "sunday-pt", start: "2026-04-13T00:00:00.000Z" }),
        googleEvent({ id: "friday-pt", start: "2026-04-11T00:00:00.000Z" }),
      ],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: "weekend",
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.range).toEqual(
      expect.objectContaining({ timezone: "America/Los_Angeles" }),
    );
    expect(deleteEventMock.mock.calls.map((call) => call[0])).toEqual([
      "sunday-pt",
    ]);
  });

  it("rejects an invalid timezone rather than silently filtering in UTC", async () => {
    await expect(
      run({
        from: "2026-04-06",
        to: "2026-04-20",
        daysOfWeek: "weekend",
        timezone: "Mars/Olympus",
        scope: "single",
        sendUpdates: "none",
      }),
    ).rejects.toThrow(/invalid iana timezone/i);
    expect(listGoogleEventsMock).not.toHaveBeenCalled();
  });

  it("rejects a corrupt saved calendar timezone instead of guessing", async () => {
    getUserSettingMock.mockImplementation(async (_email, key) =>
      key === "calendar-settings" ? { timezone: "Not/AZone" } : null,
    );

    await expect(
      run({
        from: "2026-04-06",
        to: "2026-04-20",
        daysOfWeek: "weekend",
        scope: "single",
        sendUpdates: "none",
      }),
    ).rejects.toThrow(/saved calendar timezone/i);
  });

  it("keeps an explicitly named event that is backing an active booking", async () => {
    bookingRowsMock.mockResolvedValue([
      {
        id: "bk1",
        name: "Ada",
        email: "ada@example.com",
        slug: "intro",
        start: "2026-04-11T18:00:00.000Z",
        end: "2026-04-11T18:30:00.000Z",
        eventTitle: "Intro call",
        notes: "",
        meetingLink: "",
        googleEventId: "linked",
        status: "confirmed",
        createdAt: "2026-04-01T00:00:00.000Z",
      },
    ]);

    const result = await run({
      ids: ["google-linked", "google-plain"],
      scope: "single",
      sendUpdates: "none",
    });

    expect(deleteEventMock.mock.calls.map((call) => call[0])).toEqual([
      "plain",
    ]);
    expect(result.deleted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "google-linked",
          outcome: "skipped",
          reason: expect.stringMatching(/cancel the booking/i),
        }),
      ]),
    );
  });

  it("keeps a same-day all-day event when the end bound carries a time", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [
        googleEvent({
          id: "allday-sat",
          start: "2026-04-11",
          end: "2026-04-12",
          allDay: true,
        }),
      ],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      // Midday on the same Saturday: local midnight precedes it, so the all-day
      // event is inside the range even though the date strings are equal.
      to: "2026-04-11T12:00:00-07:00",
      daysOfWeek: "saturday",
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.deleted).toBe(1);
    expect(deleteEventMock.mock.calls.map((call) => call[0])).toEqual([
      "allday-sat",
    ]);
  });

  it("marks coverage incomplete when a source could not be read", async () => {
    getUserSettingMock.mockImplementation(async (_email, key) =>
      key === "external-calendars"
        ? [
            {
              id: "feed-3",
              name: "Down feed",
              url: "https://example.com/down.ics",
              color: "#000",
            },
          ]
        : null,
    );
    fetchICalEventsMock.mockRejectedValue(new Error("timeout"));
    listGoogleEventsMock.mockResolvedValue({
      events: [googleEvent({ id: "sat", start: "2026-04-11T18:00:00.000Z" })],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: "saturday",
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.deleted).toBe(1);
    expect(result.coverageComplete).toBe(false);
  });

  it("marks coverage complete when every source was read", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [googleEvent({ id: "sat", start: "2026-04-11T18:00:00.000Z" })],
      errors: [],
    });

    const result = await run({
      from: "2026-04-06",
      to: "2026-04-20",
      daysOfWeek: "saturday",
      scope: "single",
      sendUpdates: "none",
    });

    expect(result.coverageComplete).toBe(true);
    expect(result.unreadableSources).toBeUndefined();
  });

  it("refuses a match set larger than one bulk delete may commit", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: Array.from({ length: 201 }, (_, index) =>
        googleEvent({
          id: `sat-${index}`,
          start: "2026-04-11T18:00:00.000Z",
        }),
      ),
      errors: [],
    });

    await expect(
      run({
        from: "2026-04-06",
        to: "2026-04-20",
        daysOfWeek: "saturday",
        scope: "single",
        sendUpdates: "none",
      }),
    ).rejects.toThrow(/over the 200 limit/i);
    expect(deleteEventMock).not.toHaveBeenCalled();
  });
});
