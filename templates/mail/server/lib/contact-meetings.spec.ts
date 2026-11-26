import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeAgentAction: vi.fn(),
  resolveA2ACallerAuth: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getClientsWithErrors: vi.fn(),
  calendarListEvents: vi.fn(),
}));

vi.mock("@agent-native/core/a2a", () => ({
  invokeAgentAction: mocks.invokeAgentAction,
  resolveA2ACallerAuth: mocks.resolveA2ACallerAuth,
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("./peer-apps.js", () => ({
  peerAppTarget: () => "calendar",
  peerAppUrl: () => "https://calendar.agent-native.com",
}));

vi.mock("./google-auth.js", () => ({
  getClientsWithErrors: mocks.getClientsWithErrors,
}));

vi.mock("./google-api.js", () => ({
  calendarListEvents: mocks.calendarListEvents,
}));

import { listContactMeetings } from "./contact-meetings.js";

const OWNER = "owner@example.com";
const ACCOUNT = "inbox@example.com";
const PRIYA = "priya@northwind.example";
const NOW = new Date("2026-11-26T15:00:00Z");

type Item = Record<string, unknown> & { start: string; end: string };

function item(
  id: string,
  start: string,
  attendees: string[],
  extra: Record<string, unknown> = {},
): Item {
  const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
  return {
    key: `google:${ACCOUNT}:${id}`,
    id,
    title: `Meeting ${id}`,
    start,
    end,
    allDay: false,
    source: "google",
    accountEmail: ACCOUNT,
    calendarSourceKey: "source-1",
    organizer: { email: OWNER, self: true },
    attendeeCount: attendees.length,
    attendeeStatusCounts: {},
    attendees: attendees.map((email) => ({ email })),
    attendeesComplete: true,
    ...extra,
  };
}

function inventory(items: Item[], extra: Record<string, unknown> = {}) {
  return {
    target: { url: "https://calendar.agent-native.com" },
    action: "list-events",
    result: {
      status: "completed",
      output: JSON.stringify({
        version: 1,
        resolvedAccounts: [ACCOUNT],
        queriedAccounts: [ACCOUNT],
        accounts: [
          { accountEmail: ACCOUNT, status: "ok", count: items.length },
        ],
        sourceCoverage: [],
        coverageComplete: true,
        items,
        page: { returned: items.length, hasMore: false },
        ...extra,
      }),
    },
  };
}

function serveCalendar(items: Item[]) {
  mocks.invokeAgentAction.mockImplementation(
    async ({ input }: { input: { from: string; to: string } }) =>
      inventory(
        items.filter(
          (entry) =>
            Date.parse(entry.start) <= Date.parse(input.to) &&
            Date.parse(entry.end) >= Date.parse(input.from),
        ),
      ),
  );
}

function calendarNotConnected() {
  mocks.invokeAgentAction.mockResolvedValue(
    inventory([], {
      resolvedAccounts: [],
      queriedAccounts: [],
      accounts: [],
      sourceCoverage: [
        {
          source: "google",
          id: "owned-accounts",
          status: "error",
          error: { code: "NOT_CONNECTED", message: "Not connected" },
        },
      ],
    }),
  );
}

function googlePage(
  items: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) {
  return { kind: "calendar#events", items, ...extra };
}

function calls() {
  return mocks.invokeAgentAction.mock.calls.map(
    ([call]) => call.input as { from: string; to: string; cursor?: string },
  );
}

function googleEvent(id: string, start: string, attendees: string[]) {
  const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
  return {
    id,
    summary: `Google ${id}`,
    status: "confirmed",
    htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
    start: { dateTime: start },
    end: { dateTime: end },
    organizer: { email: OWNER },
    attendees: attendees.map((email) => ({ email })),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.resolveA2ACallerAuth.mockImplementation(async () => ({
    userEmail: mocks.getRequestUserEmail(),
  }));
  mocks.getClientsWithErrors.mockResolvedValue({
    clients: [{ email: ACCOUNT, accessToken: "token", refreshToken: "" }],
    errors: [],
  });
  mocks.calendarListEvents.mockResolvedValue(googlePage([]));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("listContactMeetings", () => {
  it("lists Calendar's events with the person, soonest and newest first", async () => {
    serveCalendar([
      item("past-old", "2026-11-20T15:00:00Z", [PRIYA]),
      item("past-new", "2026-11-24T15:00:00Z", [OWNER, PRIYA]),
      item("next", "2026-11-27T15:00:00Z", [], {
        organizer: { email: PRIYA },
      }),
      item("crowded", "2026-12-03T15:00:00Z", ["someone@example.com"], {
        attendeesComplete: false,
      }),
      item("mentions-her", "2026-11-28T15:00:00Z", ["someone@example.com"]),
      item("cancelled", "2026-11-29T15:00:00Z", [PRIYA], {
        status: "cancelled",
      }),
      item("office", "2026-11-30T15:00:00Z", [PRIYA], {
        eventType: "workingLocation",
      }),
    ]);

    const result = await listContactMeetings(PRIYA, 3);

    expect(result).toMatchObject({
      source: "calendar",
      calendar: "connected",
      calendarUrl: "https://calendar.agent-native.com",
      failedAccounts: [],
    });
    expect(result.upcoming.map((meeting) => meeting.id)).toEqual(["next"]);
    expect(result.recent.map((meeting) => meeting.id)).toEqual([
      "past-new",
      "past-old",
    ]);
    const url = new URL(String(result.upcoming[0]?.url));
    expect(url.origin).toBe("https://calendar.agent-native.com");
    expect(url.pathname).toBe("/_agent-native/open");
    expect(url.searchParams.get("app")).toBe("calendar");
    expect(url.searchParams.get("eventId")).toBe("next");
    expect(url.searchParams.get("date")).toBe("2026-11-27");
    expect(url.searchParams.get("calendarSourceKey")).toBe("source-1");
    expect(mocks.invokeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "calendar",
        selfAppId: "mail",
        action: "list-events",
        userEmail: OWNER,
        input: expect.objectContaining({
          query: PRIYA,
          format: "inventory",
          sources: ["google"],
        }),
      }),
    );
    expect(mocks.calendarListEvents).not.toHaveBeenCalled();
  });

  it("reads the nearest two weeks first and goes further only when it needs to", async () => {
    const windows = () =>
      calls()
        .map(({ from, to }) => `${from} to ${to}`)
        .sort();

    serveCalendar([
      item("recent", "2026-11-24T15:00:00Z", [PRIYA]),
      item("soon", "2026-11-30T15:00:00Z", [PRIYA]),
    ]);
    await listContactMeetings(PRIYA, 1);
    expect(windows()).toEqual([
      "2026-11-12T15:00:00.000Z to 2026-11-26T15:00:00.000Z",
      "2026-11-26T15:00:00.000Z to 2026-12-10T15:00:00.000Z",
    ]);

    mocks.invokeAgentAction.mockClear();
    serveCalendar([
      item("long-ago", "2026-09-10T15:00:00Z", [PRIYA]),
      item("next-month", "2027-01-05T15:00:00Z", [PRIYA]),
    ]);
    const result = await listContactMeetings(PRIYA, 1);
    expect(windows()).toEqual([
      "2026-08-28T15:00:00.000Z to 2026-11-12T15:00:00.000Z",
      "2026-11-12T15:00:00.000Z to 2026-11-26T15:00:00.000Z",
      "2026-11-26T15:00:00.000Z to 2026-12-10T15:00:00.000Z",
      "2026-12-10T15:00:00.000Z to 2027-01-25T15:00:00.000Z",
    ]);
    expect(result.recent.map((meeting) => meeting.id)).toEqual(["long-ago"]);
    expect(result.upcoming.map((meeting) => meeting.id)).toEqual([
      "next-month",
    ]);
  });

  it("keeps reading the past when a long event started before the window", async () => {
    serveCalendar([
      item("retreat", "2026-10-27T15:00:00Z", [PRIYA], {
        end: "2026-11-25T15:00:00Z",
      }),
      item("one-on-one", "2026-11-11T15:00:00Z", [PRIYA]),
    ]);

    const result = await listContactMeetings(PRIYA, 1);

    expect(result.recent.map((meeting) => meeting.id)).toEqual(["one-on-one"]);
  });

  it("reads every page of a window, so events that only mention the person can't hide a meeting", async () => {
    mocks.invokeAgentAction.mockImplementation(
      async ({ input }: { input: { from: string; cursor?: string } }) => {
        const upcoming = Date.parse(input.from) >= NOW.getTime();
        if (!input.cursor) {
          return inventory(
            [
              upcoming
                ? item("mentions", "2026-11-27T15:00:00Z", [OWNER])
                : item("first", "2026-11-21T15:00:00Z", [PRIYA]),
            ],
            { page: { returned: 1, hasMore: true, nextCursor: "page-2" } },
          );
        }
        return inventory([
          upcoming
            ? item("next", "2026-11-28T15:00:00Z", [PRIYA])
            : item("second", "2026-11-25T15:00:00Z", [PRIYA]),
        ]);
      },
    );

    const result = await listContactMeetings(PRIYA, 1);

    expect(result.upcoming.map((meeting) => meeting.id)).toEqual(["next"]);
    expect(result.recent.map((meeting) => meeting.id)).toEqual(["second"]);
  });

  it("reads up to four pages of a window and never asks for a fifth", async () => {
    const servePages = (last: number) =>
      mocks.invokeAgentAction.mockImplementation(
        async ({ input }: { input: { from: string; cursor?: string } }) => {
          const page = Number(input.cursor?.replace("page-", "") ?? 1);
          const upcoming = Date.parse(input.from) >= NOW.getTime();
          const found =
            page === last
              ? [
                  upcoming
                    ? item("next", "2026-11-27T15:00:00Z", [PRIYA])
                    : item("last", "2026-11-25T15:00:00Z", [PRIYA]),
                ]
              : [];
          return inventory(found, {
            page:
              page < last
                ? {
                    returned: found.length,
                    hasMore: true,
                    nextCursor: `page-${page + 1}`,
                  }
                : { returned: found.length, hasMore: false },
          });
        },
      );

    servePages(4);
    await expect(listContactMeetings(PRIYA, 1)).resolves.toMatchObject({
      source: "calendar",
      upcoming: [{ id: "next" }],
      recent: [{ id: "last" }],
    });
    expect(calls()).toHaveLength(8);

    mocks.invokeAgentAction.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    servePages(5);
    await expect(listContactMeetings(PRIYA, 1)).resolves.toMatchObject({
      source: "mail",
      calendar: "unavailable",
    });
    expect(calls().map((input) => input.cursor)).not.toContain("page-5");
  });

  it("stops reading Calendar once the other direction has failed", async () => {
    vi.useFakeTimers({
      now: NOW,
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.invokeAgentAction.mockImplementation(
      async ({ input }: { input: { from: string } }) => {
        if (Date.parse(input.from) < NOW.getTime()) {
          throw new Error("Calendar crashed");
        }
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                inventory([], {
                  page: { returned: 0, hasMore: true, nextCursor: "more" },
                }),
              ),
            100,
          ),
        );
      },
    );

    await expect(listContactMeetings(PRIYA, 3)).resolves.toMatchObject({
      source: "mail",
      calendar: "unavailable",
    });
    const asked = mocks.invokeAgentAction.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.invokeAgentAction).toHaveBeenCalledTimes(asked);
  });

  it("uses Mail's Google access rather than part of a window Calendar couldn't finish", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      inventory([item("busy", "2026-11-25T15:00:00Z", [PRIYA])], {
        page: { returned: 1, hasMore: true, nextCursor: "more" },
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await listContactMeetings(PRIYA, 3);

    expect(result).toMatchObject({ source: "mail", calendar: "unavailable" });
  });

  it("uses Calendar's workspace connection when the user has no Google account of their own", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      inventory([item("next", "2026-11-27T15:00:00Z", [PRIYA])], {
        resolvedAccounts: [],
        accounts: [],
      }),
    );

    const result = await listContactMeetings(PRIYA, 3);

    expect(result.source).toBe("calendar");
    expect(result.upcoming.map((meeting) => meeting.id)).toEqual(["next"]);
  });

  it("keeps an all-day event upcoming until the end of the user's day", async () => {
    vi.setSystemTime(new Date("2026-11-27T01:00:00Z"));
    serveCalendar([
      item("offsite", "2026-11-26", [PRIYA], {
        end: "2026-11-27",
        allDay: true,
      }),
    ]);

    const pacific = await listContactMeetings(PRIYA, 3, "America/Los_Angeles");
    expect(pacific.upcoming.map((meeting) => meeting.id)).toEqual(["offsite"]);

    const utc = await listContactMeetings(PRIYA, 3);
    expect(utc.recent.map((meeting) => meeting.id)).toEqual(["offsite"]);
  });

  it("puts a late meeting tonight ahead of tomorrow's all-day event", async () => {
    vi.setSystemTime(new Date("2026-11-27T05:00:00Z"));
    serveCalendar([
      item("offsite", "2026-11-27", [PRIYA], {
        end: "2026-11-28",
        allDay: true,
      }),
      item("late-call", "2026-11-27T07:30:00Z", [PRIYA]),
    ]);

    const result = await listContactMeetings(PRIYA, 1, "America/Los_Angeles");

    expect(result.upcoming.map((meeting) => meeting.id)).toEqual(["late-call"]);
  });

  it("keeps an account Calendar couldn't read apart from an empty one", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      inventory([item("next", "2026-11-27T15:00:00Z", [PRIYA])], {
        resolvedAccounts: [ACCOUNT, "work@example.com"],
        accounts: [
          { accountEmail: ACCOUNT, status: "ok", count: 1 },
          {
            accountEmail: "work@example.com",
            status: "error",
            error: { message: "Token expired" },
          },
        ],
      }),
    );

    const result = await listContactMeetings(PRIYA, 3);

    expect(result.source).toBe("calendar");
    expect(result.failedAccounts).toEqual([
      { accountEmail: "work@example.com", message: "Token expired" },
    ]);
  });

  it("uses Mail's Google access and suggests Calendar when Calendar has no Google account", async () => {
    calendarNotConnected();
    mocks.calendarListEvents.mockResolvedValue(
      googlePage([
        googleEvent("g-next", "2026-11-27T15:00:00Z", [PRIYA]),
        googleEvent("g-past", "2026-11-25T15:00:00Z", [PRIYA]),
        googleEvent("g-other", "2026-11-28T15:00:00Z", ["other@example.com"]),
        {
          ...googleEvent("g-created", "2026-11-29T15:00:00Z", []),
          creator: { email: PRIYA },
        },
      ]),
    );

    const result = await listContactMeetings(PRIYA, 3);

    expect(result).toMatchObject({
      source: "mail",
      calendar: "not_connected",
      calendarUrl: "https://calendar.agent-native.com",
      upcoming: [
        {
          id: "g-next",
          title: "Google g-next",
          url: "https://www.google.com/calendar/event?eid=g-next",
          accountEmail: ACCOUNT,
        },
      ],
      recent: [{ id: "g-past" }],
      failedAccounts: [],
    });
    expect(mocks.calendarListEvents).toHaveBeenCalledWith("token", "primary", {
      q: PRIYA,
      timeMin: "2026-08-28T15:00:00.000Z",
      timeMax: "2027-01-25T15:00:00.000Z",
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: 250,
    });
  });

  it("follows Google's pages in Mail's own lookup", async () => {
    calendarNotConnected();
    mocks.calendarListEvents.mockImplementation(
      async (
        _token: string,
        _calendar: string,
        params: { pageToken?: string },
      ) =>
        params.pageToken
          ? googlePage([googleEvent("g-next", "2026-11-27T15:00:00Z", [PRIYA])])
          : googlePage(
              [googleEvent("g-old", "2026-09-01T15:00:00Z", [PRIYA])],
              { nextPageToken: "page-2" },
            ),
    );

    const result = await listContactMeetings(PRIYA, 3);

    expect(result.upcoming.map((meeting) => meeting.id)).toEqual(["g-next"]);
    expect(mocks.calendarListEvents).toHaveBeenLastCalledWith(
      "token",
      "primary",
      expect.objectContaining({ pageToken: "page-2" }),
    );
  });

  it("uses Mail's Google access when Calendar fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.calendarListEvents.mockResolvedValue(
      googlePage([googleEvent("g-next", "2026-11-27T15:00:00Z", [PRIYA])]),
    );

    mocks.invokeAgentAction.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(listContactMeetings(PRIYA, 3)).resolves.toMatchObject({
      source: "mail",
      calendar: "unavailable",
      upcoming: [{ id: "g-next" }],
    });

    mocks.resolveA2ACallerAuth.mockRejectedValue(new Error("No org secret"));
    await expect(listContactMeetings(PRIYA, 3)).resolves.toMatchObject({
      source: "mail",
      calendar: "unavailable",
    });
  });

  it("uses Mail's Google access when Calendar doesn't answer in time", async () => {
    vi.useFakeTimers({
      now: NOW,
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });
    mocks.invokeAgentAction.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(inventory([])), 6_000),
        ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const pending = listContactMeetings(PRIYA, 3);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toMatchObject({
      source: "mail",
      calendar: "unavailable",
    });
    const asked = mocks.invokeAgentAction.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.invokeAgentAction).toHaveBeenCalledTimes(asked);
  });

  it("names Mail accounts it couldn't read and fails when none could be read", async () => {
    calendarNotConnected();
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        { email: ACCOUNT, accessToken: "token", refreshToken: "" },
        { email: "work@example.com", accessToken: "work", refreshToken: "" },
      ],
      errors: [],
    });
    mocks.calendarListEvents.mockImplementation(async (token: string) => {
      if (token === "work") {
        throw Object.assign(new Error("Google API error (403): denied"), {
          status: 403,
        });
      }
      return googlePage([
        googleEvent("g-next", "2026-11-27T15:00:00Z", [PRIYA]),
      ]);
    });

    const partial = await listContactMeetings(PRIYA, 3);
    expect(partial.upcoming.map((meeting) => meeting.id)).toEqual(["g-next"]);
    expect(partial.failedAccounts).toEqual([
      {
        accountEmail: "work@example.com",
        message:
          "Mail can't read this account's calendar. Reconnect the account to allow it.",
      },
    ]);

    mocks.calendarListEvents.mockRejectedValue(new Error("Network down"));
    await expect(listContactMeetings(PRIYA, 3)).rejects.toMatchObject({
      errorCode: "meetings_unavailable",
      statusCode: 502,
    });

    mocks.calendarListEvents.mockResolvedValue(undefined);
    await expect(listContactMeetings(PRIYA, 3)).rejects.toMatchObject({
      errorCode: "meetings_unavailable",
    });

    mocks.calendarListEvents.mockResolvedValue(
      googlePage([], { items: "corrupted", nextPageToken: false }),
    );
    await expect(listContactMeetings(PRIYA, 3)).rejects.toMatchObject({
      errorCode: "meetings_unavailable",
    });
  });

  it("says no calendar is connected rather than no meetings", async () => {
    calendarNotConnected();
    mocks.getClientsWithErrors.mockResolvedValue({ clients: [], errors: [] });

    await expect(listContactMeetings(PRIYA, 3)).resolves.toEqual({
      source: "none",
      calendar: "not_connected",
      calendarUrl: "https://calendar.agent-native.com",
      upcoming: [],
      recent: [],
      failedAccounts: [],
    });
  });
});
