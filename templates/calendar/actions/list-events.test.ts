import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestTimezoneMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const isConnectedMock = vi.hoisted(() => vi.fn());
const getOwnedAccountEmailsMock = vi.hoisted(() => vi.fn());
const listGoogleEventsMock = vi.hoisted(() => vi.fn());
const listOverlayEventsMock = vi.hoisted(() => vi.fn());
const fetchICalEventsMock = vi.hoisted(() => vi.fn());
const signShortLivedTokenMock = vi.hoisted(() => vi.fn());
const verifyShortLivedTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestTimezone: getRequestTimezoneMock,
  getRequestUserEmail: getRequestUserEmailMock,
  signShortLivedToken: signShortLivedTokenMock,
  verifyShortLivedToken: verifyShortLivedTokenMock,
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

vi.mock("../server/lib/google-calendar.js", () => ({
  isConnected: isConnectedMock,
  getOwnedAccountEmails: getOwnedAccountEmailsMock,
  listEvents: listGoogleEventsMock,
  listOverlayEvents: listOverlayEventsMock,
}));

vi.mock("../server/lib/ical-fetcher.js", () => ({
  fetchICalEvents: fetchICalEventsMock,
}));

const schemaMock = vi.hoisted(() => ({
  bookingLinks: {
    slug: "bookingLinks.slug",
    title: "bookingLinks.title",
    color: "bookingLinks.color",
  },
  bookingLinkShares: {},
  bookings: {
    id: "bookings.id",
    name: "bookings.name",
    email: "bookings.email",
    slug: "bookings.slug",
    start: "bookings.start",
    end: "bookings.end",
    eventTitle: "bookings.eventTitle",
    notes: "bookings.notes",
    meetingLink: "bookings.meetingLink",
    googleEventId: "bookings.googleEventId",
    status: "bookings.status",
    createdAt: "bookings.createdAt",
  },
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: schemaMock,
}));

import {
  listCalendarEvents,
  resolveCalendarEventRange,
} from "./list-events.js";
import listEventsAction from "./list-events.js";

function createDbMock({
  links = [
    {
      slug: "intro",
      title: "Intro call",
      color: "#5B9BD5",
    },
  ],
  bookings = [],
}: {
  links?: Array<{ slug: string; title: string; color?: string }>;
  bookings?: Array<Record<string, unknown>>;
} = {}) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table) => ({
        where: vi.fn(async () =>
          table === schemaMock.bookingLinks ? links : bookings,
        ),
      })),
    })),
  };
}

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    name: "Nikoline Hogh",
    email: "nikoline@example.com",
    slug: "intro",
    start: "2026-06-17T16:00:00.000Z",
    end: "2026-06-17T16:30:00.000Z",
    eventTitle: "Steve + Nikoline",
    notes: null,
    meetingLink: "https://example.com/meet",
    googleEventId: "google-event-1",
    status: "confirmed",
    createdAt: "2026-06-12T10:13:39.746Z",
    ...overrides,
  };
}

describe("listCalendarEvents booking merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestTimezoneMock.mockReturnValue("UTC");
    getRequestUserEmailMock.mockReturnValue("steve@example.com");
    getUserSettingMock.mockResolvedValue(null);
    getDbMock.mockReturnValue(createDbMock());
    isConnectedMock.mockResolvedValue(true);
    getOwnedAccountEmailsMock.mockResolvedValue(["steve@example.com"]);
    listGoogleEventsMock.mockResolvedValue({ events: [], errors: [] });
    listOverlayEventsMock.mockResolvedValue({ events: [], errors: [] });
    fetchICalEventsMock.mockResolvedValue([]);
    signShortLivedTokenMock.mockImplementation(
      ({ resourceId }) =>
        `${Buffer.from(JSON.stringify({ resourceId })).toString("base64url")}.signature`,
    );
    verifyShortLivedTokenMock.mockReturnValue({ ok: true });
  });

  it("hides a linked local booking when Google was read successfully but no longer returns the event", async () => {
    getDbMock.mockReturnValue(createDbMock({ bookings: [bookingRow()] }));

    const result = await listCalendarEvents({
      from: "2026-06-17",
      to: "2026-06-18",
    });

    expect(result.events).toEqual([]);
  });

  it("keeps an unlinked local booking when Google was read successfully", async () => {
    getDbMock.mockReturnValue(
      createDbMock({ bookings: [bookingRow({ googleEventId: null })] }),
    );

    const result = await listCalendarEvents({
      from: "2026-06-17",
      to: "2026-06-18",
    });

    expect(result.events).toMatchObject([
      {
        id: "booking:booking-1",
        title: "Steve + Nikoline",
        source: "local",
        googleEventId: undefined,
      },
    ]);
  });

  it("keeps a linked local booking as fallback when Google returned an error", async () => {
    getDbMock.mockReturnValue(createDbMock({ bookings: [bookingRow()] }));
    listGoogleEventsMock.mockResolvedValue({
      events: [],
      errors: [{ email: "steve@example.com", error: "401 Unauthorized" }],
    });

    const result = await listCalendarEvents({
      from: "2026-06-17",
      to: "2026-06-18",
    });

    expect(result.events).toMatchObject([
      {
        id: "booking:booking-1",
        title: "Steve + Nikoline",
        source: "local",
        googleEventId: "google-event-1",
      },
    ]);
    expect(result.errors).toEqual([
      { email: "steve@example.com", error: "401 Unauthorized" },
    ]);
  });

  it("still de-duplicates a linked local booking while Google returns the event", async () => {
    getDbMock.mockReturnValue(createDbMock({ bookings: [bookingRow()] }));
    listGoogleEventsMock.mockResolvedValue({
      events: [
        {
          id: "google-google-event-1",
          title: "Steve + Nikoline",
          description: "",
          start: "2026-06-17T16:00:00.000Z",
          end: "2026-06-17T16:30:00.000Z",
          location: "",
          allDay: false,
          source: "google",
          googleEventId: "google-event-1",
          createdAt: "2026-06-12T10:13:39.746Z",
          updatedAt: "2026-06-12T10:13:39.746Z",
        },
      ],
      errors: [],
    });

    const result = await listCalendarEvents({
      from: "2026-06-17",
      to: "2026-06-18",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "google-google-event-1",
      source: "google",
      googleEventId: "google-event-1",
    });
  });
});

describe("list-events inventory contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestTimezoneMock.mockReturnValue("UTC");
    getRequestUserEmailMock.mockReturnValue("owner@example.com");
    getUserSettingMock.mockResolvedValue(null);
    getDbMock.mockReturnValue(createDbMock());
    isConnectedMock.mockResolvedValue(true);
    getOwnedAccountEmailsMock.mockResolvedValue(["steve@example.com"]);
    listGoogleEventsMock.mockResolvedValue({ events: [], errors: [] });
    listOverlayEventsMock.mockResolvedValue({ events: [], errors: [] });
    fetchICalEventsMock.mockResolvedValue([]);
    signShortLivedTokenMock.mockImplementation(
      ({ resourceId }) =>
        `${Buffer.from(JSON.stringify({ resourceId })).toString("base64url")}.signature`,
    );
    verifyShortLivedTokenMock.mockReturnValue({ ok: true });
  });

  it("keeps legacy callers on CalendarEvent arrays", async () => {
    const result = await (listEventsAction as any).run(
      { from: "2026-06-17", to: "2026-06-18" },
      { caller: "frontend" },
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns compact coverage-aware inventory to MCP", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [
        {
          id: "google-event-1",
          googleEventId: "event-1",
          title: "A deliberately ordinary event",
          description: "not returned",
          start: "2026-06-17T16:00:00.000Z",
          end: "2026-06-17T16:30:00.000Z",
          location: "not returned",
          allDay: false,
          source: "google",
          accountEmail: "steve@example.com",
          attendees: [
            { email: "guest@example.com", responseStatus: "accepted" },
          ],
          createdAt: "2026-06-12T10:13:39.746Z",
          updatedAt: "2026-06-12T10:13:39.746Z",
        },
      ],
      errors: [],
    });
    const result = await (listEventsAction as any).run(
      { from: "2026-06-17", to: "2026-06-18" },
      { caller: "mcp" },
    );
    expect(result).toMatchObject({
      version: 1,
      requestedAccounts: null,
      resolvedAccounts: ["steve@example.com"],
      queriedAccounts: ["steve@example.com"],
      coverageComplete: true,
      page: { returned: 1, hasMore: false },
    });
    expect(result.items[0]).toMatchObject({
      id: "event-1",
      source: "google",
      accountEmail: "steve@example.com",
      attendeeCount: 1,
      attendeeStatusCounts: { accepted: 1 },
    });
    expect(result.items[0]).not.toHaveProperty("description");
  });

  it("rejects an unowned account before fetching Google", async () => {
    getOwnedAccountEmailsMock.mockResolvedValue(["steve@example.com"]);
    listGoogleEventsMock.mockClear();
    await expect(
      listCalendarEvents({
        from: "2026-06-17",
        to: "2026-06-18",
        accountEmails: ["other@example.com"],
      }),
    ).rejects.toThrow("not connected");
    expect(listGoogleEventsMock).not.toHaveBeenCalled();
  });

  it("rejects an explicitly empty account selection", async () => {
    await expect(
      (listEventsAction as any).run(
        {
          from: "2026-06-17",
          to: "2026-06-18",
          accountEmails: [],
        },
        { caller: "mcp" },
      ),
    ).rejects.toThrow();
    expect(getOwnedAccountEmailsMock).not.toHaveBeenCalled();
    expect(listGoogleEventsMock).not.toHaveBeenCalled();
  });

  it("keeps successful empty and failed owned accounts explicit", async () => {
    getOwnedAccountEmailsMock.mockResolvedValue([
      "quiet@example.com",
      "failed@example.com",
    ]);
    listGoogleEventsMock.mockResolvedValue({
      events: [],
      errors: [{ email: "failed@example.com", error: "quota exhausted" }],
    });

    const result = await (listEventsAction as any).run(
      {
        from: "2026-06-17",
        to: "2026-06-18",
        accountEmails: ["QUIET@example.com", "failed@example.com"],
      },
      { caller: "mcp" },
    );

    expect(result.accounts).toEqual([
      {
        accountEmail: "quiet@example.com",
        status: "ok",
        count: 0,
        exhausted: true,
      },
      {
        accountEmail: "failed@example.com",
        status: "error",
        count: 0,
        exhausted: false,
        error: {
          code: "PROVIDER_READ_FAILED",
          message: "quota exhausted",
          retryable: true,
        },
      },
    ]);
    expect(result).toMatchObject({
      requestedAccounts: ["failed@example.com", "quiet@example.com"],
      coverageComplete: false,
      complete: false,
      items: [],
    });
  });

  it("deduplicates a successful account's Google event while another account fails", async () => {
    getOwnedAccountEmailsMock.mockResolvedValue([
      "working@example.com",
      "failed@example.com",
    ]);
    getDbMock.mockReturnValue(createDbMock({ bookings: [bookingRow()] }));
    listGoogleEventsMock.mockResolvedValue({
      events: [
        {
          id: "google-google-event-1",
          googleEventId: "google-event-1",
          title: "Provider copy",
          description: "",
          start: "2026-06-17T16:00:00.000Z",
          end: "2026-06-17T16:30:00.000Z",
          location: "",
          allDay: false,
          source: "google",
          accountEmail: "working@example.com",
          createdAt: "2026-06-12T10:13:39.746Z",
          updatedAt: "2026-06-12T10:13:39.746Z",
        },
      ],
      errors: [{ email: "failed@example.com", error: "provider unavailable" }],
    });

    const result = await (listEventsAction as any).run(
      { from: "2026-06-17", to: "2026-06-18" },
      { caller: "mcp" },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "google-event-1",
      source: "google",
      accountEmail: "working@example.com",
    });
    expect(result.accounts).toContainEqual(
      expect.objectContaining({
        accountEmail: "failed@example.com",
        status: "error",
      }),
    );
  });

  it("reports a failed ICS source instead of treating it as empty success", async () => {
    getUserSettingMock.mockResolvedValue([
      {
        id: "team-feed",
        name: "Team feed",
        url: "https://calendar.example.test/team.ics",
        color: "blue",
      },
    ]);
    fetchICalEventsMock.mockRejectedValue(new Error("ICS feed request failed"));

    const result = await (listEventsAction as any).run(
      {
        from: "2026-06-17",
        to: "2026-06-18",
        sources: ["ics"],
      },
      { caller: "mcp" },
    );

    expect(result.sourceCoverage).toEqual([
      {
        source: "ics",
        id: "team-feed",
        status: "error",
        error: {
          code: "SOURCE_READ_FAILED",
          message: "ICS feed request failed",
          retryable: true,
        },
      },
    ]);
    expect(result.coverageComplete).toBe(false);
  });

  it("preserves ICS feed provenance on compact items", async () => {
    getUserSettingMock.mockResolvedValue([
      {
        id: "team-feed",
        name: "Team feed",
        url: "https://calendar.example.test/team.ics",
        color: "blue",
      },
    ]);
    fetchICalEventsMock.mockResolvedValue([
      {
        id: "ical-team-feed-event-1",
        title: "Feed event",
        description: "not returned",
        start: "2026-06-17T18:00:00.000Z",
        end: "2026-06-17T18:30:00.000Z",
        location: "not returned",
        allDay: false,
        source: "ical",
        sourceId: "team-feed",
        createdAt: "2026-06-12T10:13:39.746Z",
        updatedAt: "2026-06-12T10:13:39.746Z",
      },
    ]);

    const result = await (listEventsAction as any).run(
      {
        from: "2026-06-17",
        to: "2026-06-18",
        sources: ["ics"],
      },
      { caller: "mcp" },
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        id: "ical-team-feed-event-1",
        source: "ics",
        sourceId: "team-feed",
      }),
    ]);
    expect(result.items[0]).not.toHaveProperty("description");
  });

  it("reports requested overlays when Google is disconnected", async () => {
    isConnectedMock.mockResolvedValue(false);
    getOwnedAccountEmailsMock.mockResolvedValue([]);

    const result = await (listEventsAction as any).run(
      {
        from: "2026-06-17",
        to: "2026-06-18",
        sources: ["overlays"],
        overlayEmails: ["person@example.com"],
      },
      { caller: "mcp" },
    );

    expect(result.sourceCoverage).toEqual([
      {
        source: "overlay",
        id: "person@example.com",
        status: "error",
        error: {
          code: "NOT_CONNECTED",
          message: "Google Calendar is not connected",
          retryable: false,
        },
      },
    ]);
    expect(result.coverageComplete).toBe(false);
    expect(listOverlayEventsMock).not.toHaveBeenCalled();
  });

  it("binds inventory cursors to the owner and exact query", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: [
        {
          id: "google-event-1",
          googleEventId: "event-1",
          title: "First",
          description: "",
          start: "2026-06-17T16:00:00.000Z",
          end: "2026-06-17T16:30:00.000Z",
          location: "",
          allDay: false,
          source: "google",
          accountEmail: "steve@example.com",
          createdAt: "2026-06-12T10:13:39.746Z",
          updatedAt: "2026-06-12T10:13:39.746Z",
        },
        {
          id: "google-event-2",
          googleEventId: "event-2",
          title: "Second",
          description: "",
          start: "2026-06-17T17:00:00.000Z",
          end: "2026-06-17T17:30:00.000Z",
          location: "",
          allDay: false,
          source: "google",
          accountEmail: "steve@example.com",
          createdAt: "2026-06-12T10:13:39.746Z",
          updatedAt: "2026-06-12T10:13:39.746Z",
        },
      ],
      errors: [],
    });
    const first = await (listEventsAction as any).run(
      {
        from: "2026-06-17",
        to: "2026-06-18",
        format: "inventory",
        pageSize: 1,
      },
      { caller: "mcp" },
    );
    expect(first.page).toMatchObject({ hasMore: true });
    const second = await (listEventsAction as any).run(
      {
        from: "2026-06-17",
        to: "2026-06-18",
        format: "inventory",
        pageSize: 1,
        cursor: first.page.nextCursor,
      },
      { caller: "mcp" },
    );
    expect(second.items.map((item: any) => item.id)).toEqual(["event-2"]);
    expect(second.page).toEqual({
      returned: 1,
      hasMore: false,
      nextCursor: undefined,
    });
    expect(
      [...first.items, ...second.items].map((item: any) => item.id),
    ).toEqual(["event-1", "event-2"]);
    getRequestUserEmailMock.mockReturnValue("other-owner@example.com");
    listGoogleEventsMock.mockClear();
    await expect(
      (listEventsAction as any).run(
        {
          from: "2026-06-17",
          to: "2026-06-18",
          format: "inventory",
          pageSize: 1,
          cursor: first.page.nextCursor,
        },
        { caller: "mcp" },
      ),
    ).rejects.toThrow("does not match");
    expect(listGoogleEventsMock).not.toHaveBeenCalled();
    getRequestUserEmailMock.mockReturnValue("owner@example.com");
    listGoogleEventsMock.mockClear();
    await expect(
      (listEventsAction as any).run(
        {
          from: "2026-06-18",
          to: "2026-06-19",
          format: "inventory",
          pageSize: 1,
          cursor: first.page.nextCursor,
        },
        { caller: "mcp" },
      ),
    ).rejects.toThrow("does not match");
    expect(listGoogleEventsMock).not.toHaveBeenCalled();
    verifyShortLivedTokenMock.mockReturnValueOnce({ ok: false });
    listGoogleEventsMock.mockClear();
    await expect(
      (listEventsAction as any).run(
        {
          from: "2026-06-17",
          to: "2026-06-18",
          format: "inventory",
          pageSize: 1,
          cursor: first.page.nextCursor,
        },
        { caller: "mcp" },
      ),
    ).rejects.toThrow("Expired or invalid");
    expect(listGoogleEventsMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed inventory cursor before provider reads", async () => {
    await expect(
      (listEventsAction as any).run(
        {
          from: "2026-06-17",
          to: "2026-06-18",
          format: "inventory",
          cursor: "not-a-cursor",
        },
        { caller: "mcp" },
      ),
    ).rejects.toThrow("Invalid inventory cursor");
    expect(listGoogleEventsMock).not.toHaveBeenCalled();
  });

  it("packs compact pages under the action-owned item budget", async () => {
    listGoogleEventsMock.mockResolvedValue({
      events: Array.from({ length: 100 }, (_, index) => ({
        id: `google-event-${index}`,
        googleEventId: `event-${index}`,
        title: `Event ${index} ${"x".repeat(240)}`,
        description: "not returned",
        start: new Date(Date.UTC(2026, 5, 17, 0, index)).toISOString(),
        end: new Date(Date.UTC(2026, 5, 17, 0, index + 1)).toISOString(),
        location: "not returned",
        allDay: false,
        source: "google",
        accountEmail: "steve@example.com",
        createdAt: "2026-06-12T10:13:39.746Z",
        updatedAt: "2026-06-12T10:13:39.746Z",
      })),
      errors: [],
    });

    const result = await (listEventsAction as any).run(
      {
        from: "2026-06-17",
        to: "2026-06-18",
        pageSize: 100,
      },
      { caller: "mcp" },
    );

    expect(
      Buffer.byteLength(JSON.stringify(result.items), "utf8"),
    ).toBeLessThanOrEqual(12_000);
    expect(result.page.hasMore).toBe(true);
    expect(result.page.nextCursor).toBeTruthy();
  });
});

describe("resolveCalendarEventRange", () => {
  beforeEach(() => {
    getRequestTimezoneMock.mockReturnValue("UTC");
  });

  it("uses the requested timezone when resolving date-only bounds", () => {
    const range = resolveCalendarEventRange({
      from: "2026-05-26",
      to: "2026-05-27",
      timezone: "America/Los_Angeles",
    });

    expect(range.from).toBe("2026-05-26T07:00:00.000Z");
    expect(range.to).toBe("2026-05-27T07:00:00.000Z");
  });
});
