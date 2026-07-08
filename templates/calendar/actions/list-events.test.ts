import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestTimezoneMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const isConnectedMock = vi.hoisted(() => vi.fn());
const listGoogleEventsMock = vi.hoisted(() => vi.fn());
const listOverlayEventsMock = vi.hoisted(() => vi.fn());
const fetchICalEventsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestTimezone: getRequestTimezoneMock,
  getRequestUserEmail: getRequestUserEmailMock,
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
    listGoogleEventsMock.mockResolvedValue({ events: [], errors: [] });
    listOverlayEventsMock.mockResolvedValue({ events: [], errors: [] });
    fetchICalEventsMock.mockResolvedValue([]);
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
