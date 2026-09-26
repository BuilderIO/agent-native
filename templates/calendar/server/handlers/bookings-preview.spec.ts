import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accessFilter: vi.fn(
    (
      _table: unknown,
      _shares: unknown,
      _context: unknown,
      minRole?: string,
    ) => ({ minRole: minRole ?? "viewer" }),
  ),
  createZoomMeeting: vi.fn(),
  deleteZoomMeeting: vi.fn(),
  getDb: vi.fn(),
  getFreeBusy: vi.fn(),
  getRouterParam: vi.fn(),
  getSession: vi.fn(),
  getSetting: vi.fn(),
  getUserSetting: vi.fn(),
  getDefaultAccountSelection: vi.fn(),
  createGoogleEvent: vi.fn(),
  sendBookingConfirmationEmails: vi.fn(),
  dbUpdates: [] as Array<Record<string, unknown>>,
  isConnected: vi.fn(),
  listEvents: vi.fn(),
  insertedBookings: [] as Array<Record<string, unknown>>,
  readBody: vi.fn(),
  runWithRequestContext: vi.fn(
    async (_context: unknown, fn: () => Promise<unknown>) => fn(),
  ),
  registerShareableResource: vi.fn(),
  setResponseStatus: vi.fn(),
  verifyCaptcha: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  recordChange: vi.fn(),
  readBody: mocks.readBody,
  runWithRequestContext: mocks.runWithRequestContext,
  verifyCaptcha: mocks.verifyCaptcha,
}));

vi.mock("@agent-native/core/settings", () => ({
  getSetting: mocks.getSetting,
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("@agent-native/core/sharing", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/sharing")
  >("@agent-native/core/sharing");
  return {
    ...actual,
    accessFilter: mocks.accessFilter,
    registerShareableResource: mocks.registerShareableResource,
  };
});

vi.mock("h3", async () => {
  const actual = await vi.importActual<typeof import("h3")>("h3");
  return {
    ...actual,
    defineEventHandler: (handler: unknown) => handler,
    getQuery: (event: { query: Record<string, unknown> }) => event.query,
    getRequestURL: () => new URL("https://calendar.example.com/book"),
    getRouterParam: mocks.getRouterParam,
    setResponseStatus: mocks.setResponseStatus,
  };
});

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock("../lib/google-calendar.js", () => ({
  createEvent: mocks.createGoogleEvent,
  deleteEvent: vi.fn(),
  getDefaultAccountSelection: mocks.getDefaultAccountSelection,
  getFreeBusy: mocks.getFreeBusy,
  isConnected: mocks.isConnected,
  listEvents: mocks.listEvents,
}));

vi.mock("../lib/booking-emails.js", () => ({
  sendBookingCancellationEmails: vi.fn(),
  sendBookingConfirmationEmails: mocks.sendBookingConfirmationEmails,
}));

vi.mock("../lib/zoom.js", () => ({
  createZoomMeeting: mocks.createZoomMeeting,
  deleteZoomMeeting: mocks.deleteZoomMeeting,
  needsZoomCancellationReview: vi.fn(() => false),
}));

import { schema } from "../db/index.js";
import { parseBookingConferencingConfig } from "../lib/booking-link-utils.js";
import {
  cancelBookingById,
  createBooking,
  getAvailableSlots,
  getBookingByToken,
} from "./bookings.js";

const availability = {
  timezone: "UTC",
  weeklySchedule: {
    monday: { enabled: true, slots: [{ start: "09:00", end: "11:00" }] },
    tuesday: { enabled: false, slots: [] },
    wednesday: { enabled: false, slots: [] },
    thursday: { enabled: false, slots: [] },
    friday: { enabled: false, slots: [] },
    saturday: { enabled: false, slots: [] },
    sunday: { enabled: false, slots: [] },
  },
  bufferMinutes: 0,
  minNoticeHours: 0,
  maxAdvanceDays: 365,
  slotDurationMinutes: 30,
  bookingPageSlug: "book",
};

const bookingLink = {
  isActive: true,
  ownerEmail: "owner@example.com",
  slug: "saved-meeting",
  hosts: JSON.stringify([{ email: "old-host@example.com" }]),
  duration: 30,
  durations: JSON.stringify([30]),
  conferencing: undefined as string | undefined,
};

function createDb({
  bookings = [],
  requiredLinkRole,
}: {
  bookings?: Array<Record<string, unknown>>;
  requiredLinkRole?: string;
} = {}) {
  const update = vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => ({
      where: vi.fn(async () => {
        mocks.dbUpdates.push(values);
        if (values.status === "cancelled") {
          const booking = [...mocks.insertedBookings]
            .reverse()
            .find((row) => row.status === "confirmed");
          if (booking) booking.status = "cancelled";
        }
        return [];
      }),
    })),
  }));
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({
      insert: vi.fn(() => ({
        values: vi.fn(async (booking: Record<string, unknown>) => {
          mocks.insertedBookings.push(booking);
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(async () =>
            table === schema.bookings
              ? mocks.insertedBookings.filter(
                  (booking) => booking.status !== "cancelled",
                )
              : table === schema.bookingLinks
                ? [bookingLink]
                : [],
          ),
        })),
      })),
      update,
    }),
  );
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(async (filter?: { minRole?: string }) =>
          table === schema.bookings
            ? bookings
            : table === schema.bookingLinks
              ? !requiredLinkRole || filter?.minRole === requiredLinkRole
                ? [bookingLink]
                : []
              : [],
        ),
      })),
    })),
    update,
    transaction,
  };
}

describe("draft booking availability previews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertedBookings.length = 0;
    mocks.dbUpdates.length = 0;
    bookingLink.conferencing = undefined;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
    mocks.getSession.mockResolvedValue({
      email: "owner@example.com",
      orgId: "org-1",
    });
    mocks.getSetting.mockResolvedValue(null);
    mocks.getUserSetting.mockImplementation(async (_email, key) =>
      key === "calendar-availability" ? availability : { timezone: "UTC" },
    );
    mocks.getDb.mockReturnValue(createDb());
    mocks.readBody.mockResolvedValue({
      captchaToken: "captcha-token",
      email: "guest@example.com",
      end: "2026-08-17T09:30:00.000Z",
      name: "Guest",
      slug: "saved-meeting",
      start: "2026-08-17T09:00:00.000Z",
    });
    mocks.isConnected.mockResolvedValue(true);
    mocks.getDefaultAccountSelection.mockResolvedValue({
      accountEmail: "owner@example.com",
    });
    mocks.createGoogleEvent.mockResolvedValue({ id: "google-event-id" });
    mocks.getFreeBusy.mockResolvedValue({
      calendars: {
        "owner@example.com": { busy: [] },
        "new-host@example.com": { busy: [] },
      },
      errors: [],
    });
    mocks.listEvents.mockResolvedValue({ events: [], errors: [] });
    mocks.verifyCaptcha.mockResolvedValue({ success: true });
    mocks.getRouterParam.mockReturnValue("cancel-token");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the draft slug, duration, and hosts for a saved link preview", async () => {
    const response = await (getAvailableSlots as any)({
      query: {
        date: "2026-08-17",
        duration: "45",
        slug: "saved-meeting",
        draft: JSON.stringify({
          slug: "updated-meeting",
          durations: [45],
          hosts: [{ email: "new-host@example.com" }],
        }),
      },
    });

    expect(response.slots).toHaveLength(3);
    expect(response.slots[0]).toMatchObject({
      start: "2026-08-17T09:00:00.000Z",
      end: "2026-08-17T09:45:00.000Z",
    });
    expect(mocks.getFreeBusy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      ["owner@example.com", "new-host@example.com"],
      "owner@example.com",
      "UTC",
    );
    expect(mocks.getFreeBusy.mock.calls[0]?.[2]).not.toContain(
      "old-host@example.com",
    );
    expect(mocks.accessFilter).toHaveBeenCalledWith(
      schema.bookingLinks,
      schema.bookingLinkShares,
      undefined,
      "editor",
    );
  });

  it("uses the matching username owner's timezone for public slot queries", async () => {
    mocks.getUserSetting.mockImplementation(async (_email, key) =>
      key === "calendar-availability"
        ? { ...availability, timezone: "America/Los_Angeles" }
        : null,
    );
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(async () =>
            table === schema.bookingUsernames
              ? [{ ownerEmail: "owner@example.com" }]
              : [],
          ),
        })),
      })),
    });

    const response = await (getAvailableSlots as any)({
      query: {
        date: "2026-08-17",
        duration: "30",
        slug: "book",
        username: "owner",
      },
    });

    expect(response.slots[0]).toMatchObject({
      start: "2026-08-17T16:00:00.000Z",
      end: "2026-08-17T16:30:00.000Z",
    });
    expect(mocks.getFreeBusy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      ["owner@example.com"],
      "owner@example.com",
      "America/Los_Angeles",
    );
  });

  it("returns an unavailable response when the saved link owner is disconnected", async () => {
    mocks.isConnected.mockResolvedValue(false);

    const response = await (getAvailableSlots as any)({
      query: {
        date: "2026-08-17",
        duration: "30",
        slug: "saved-meeting",
      },
    });

    expect(response).toEqual({
      error:
        "The host's calendar availability could not be checked. Please try again later.",
      code: "calendar_availability_unavailable",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      503,
    );
    expect(mocks.getFreeBusy).not.toHaveBeenCalled();
    expect(mocks.listEvents).not.toHaveBeenCalled();
  });

  it("returns an unavailable response when a direct booking finds a disconnected owner", async () => {
    mocks.isConnected.mockResolvedValue(false);
    const event = {};

    const response = await (createBooking as any)(event);

    expect(response).toEqual({
      error:
        "The host's calendar availability could not be checked. Please try again later.",
      code: "calendar_availability_unavailable",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 503);
  });

  it("confirms a reserved booking when Zoom creation has an ambiguous failure", async () => {
    bookingLink.conferencing = JSON.stringify({ type: "zoom" });
    bookingLink.hosts = JSON.stringify([]);
    mocks.createZoomMeeting.mockRejectedValueOnce(
      new Error("response lost after Zoom created the meeting"),
    );
    const event = {};

    const response = await (createBooking as any)(event);

    expect(response).toEqual(
      expect.objectContaining({
        status: "confirmed",
        meetingLinkPending: true,
      }),
    );
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 201);
    expect(mocks.insertedBookings).toHaveLength(1);
    expect(mocks.insertedBookings[0]).toEqual(
      expect.objectContaining({ status: "confirmed", zoomNeedsReview: true }),
    );
    expect(mocks.createGoogleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.any(String) }),
      expect.objectContaining({
        account: { accountEmail: "owner@example.com" },
      }),
    );
    expect(mocks.dbUpdates).toContainEqual(
      expect.objectContaining({
        googleEventId: "google-event-id",
        calendarAccountId: "owner@example.com",
        meetingLinkPending: true,
      }),
    );
    expect(mocks.sendBookingConfirmationEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        booking: expect.objectContaining({ meetingLinkPending: true }),
        manageUrl: expect.stringContaining("/booking/manage/"),
      }),
    );

    const retryResponse = await (createBooking as any)({});

    expect(retryResponse).toEqual({
      error: "This time slot is no longer available",
    });
    expect(mocks.createZoomMeeting).toHaveBeenCalledTimes(1);
    expect(mocks.insertedBookings).toHaveLength(1);
  });

  it.each([
    "{",
    "{}",
    JSON.stringify({ type: "unknown" }),
    JSON.stringify({ type: "custom" }),
    JSON.stringify({ type: "custom", url: "mailto:guest@example.com" }),
    JSON.stringify({ type: "custom", url: "not a URL" }),
  ])(
    "rejects a booking with invalid saved conferencing config: %s",
    async (conferencing) => {
      bookingLink.conferencing = conferencing;
      const db = createDb();
      mocks.getDb.mockReturnValue(db);
      const event = {};

      const response = await (createBooking as any)(event);

      expect(response).toEqual({
        error: "Failed to create booking",
        code: "invalid_conferencing_config",
      });
      expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 422);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(mocks.insertedBookings).toHaveLength(0);
      expect(mocks.createZoomMeeting).not.toHaveBeenCalled();
    },
  );

  it.each(["http://meet.example.com/room", "https://meet.example.com/room"])(
    "accepts a custom conferencing URL over HTTP(S): %s",
    (url) => {
      expect(
        parseBookingConferencingConfig(JSON.stringify({ type: "custom", url })),
      ).toEqual({ status: "valid", config: { type: "custom", url } });
    },
  );

  it("requires editor access before deleting a booking's Zoom meeting", async () => {
    const db = createDb({
      requiredLinkRole: "editor",
      bookings: [
        {
          id: "booking-1",
          slug: "saved-meeting",
          status: "confirmed",
          start: "2026-08-17T09:00:00.000Z",
          end: "2026-08-17T09:30:00.000Z",
          zoomMeetingId: "zoom-meeting-1",
          zoomAccountId: "zoom-account-1",
        },
      ],
    });
    mocks.getDb.mockReturnValue(db);

    await cancelBookingById("booking-1", "https://calendar.example.com");

    expect(mocks.accessFilter).toHaveBeenCalledWith(
      schema.bookingLinks,
      schema.bookingLinkShares,
      undefined,
      "editor",
    );
    expect(mocks.deleteZoomMeeting).toHaveBeenCalledWith({
      accountId: "zoom-account-1",
      meetingId: "zoom-meeting-1",
    });
  });

  it("releases the slot when Zoom creation never starts", async () => {
    bookingLink.conferencing = JSON.stringify({ type: "zoom" });
    bookingLink.hosts = JSON.stringify([]);
    mocks.createZoomMeeting
      .mockResolvedValueOnce({ status: "not_started" })
      .mockResolvedValueOnce({
        status: "created",
        meetingUrl: "https://zoom.us/j/meeting-id",
        meetingId: "meeting-id",
        accountId: "zoom-account-1",
      });
    const event = {};

    const response = await (createBooking as any)(event);

    expect(response).toEqual({ error: "Failed to create booking" });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 503);
    expect(mocks.insertedBookings).toHaveLength(1);
    expect(mocks.insertedBookings[0]).toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );

    const retryResponse = await (createBooking as any)({});

    expect(retryResponse).toEqual(
      expect.objectContaining({
        meetingLink: "https://zoom.us/j/meeting-id",
        status: "confirmed",
      }),
    );
    expect(mocks.dbUpdates).toContainEqual(
      expect.objectContaining({
        meetingLink: "https://zoom.us/j/meeting-id",
        meetingLinkPending: false,
      }),
    );
    expect(mocks.createZoomMeeting).toHaveBeenCalledTimes(2);
    expect(mocks.insertedBookings).toHaveLength(2);
    expect(mocks.insertedBookings[1]).toEqual(
      expect.objectContaining({ status: "confirmed" }),
    );
  });

  it("releases the slot when Zoom definitively rejects the meeting", async () => {
    bookingLink.conferencing = JSON.stringify({ type: "zoom" });
    bookingLink.hosts = JSON.stringify([]);
    mocks.createZoomMeeting
      .mockResolvedValueOnce({ status: "rejected" })
      .mockResolvedValueOnce({
        status: "created",
        meetingUrl: "https://zoom.us/j/meeting-id",
        meetingId: "meeting-id",
        accountId: "zoom-account-1",
      });
    const event = {};

    const rejectedResponse = await (createBooking as any)(event);

    expect(rejectedResponse).toEqual({ error: "Failed to create booking" });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 503);
    expect(mocks.insertedBookings[0]).toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );

    const retryResponse = await (createBooking as any)({});

    expect(retryResponse).toEqual(
      expect.objectContaining({
        meetingLink: "https://zoom.us/j/meeting-id",
        status: "confirmed",
      }),
    );
    expect(mocks.insertedBookings).toHaveLength(2);
  });

  it("returns the persisted pending meeting state to the guest manage page", async () => {
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              id: "booking-1",
              name: "Guest",
              email: "guest@example.com",
              start: "2026-08-17T09:00:00.000Z",
              end: "2026-08-17T09:30:00.000Z",
              slug: "saved-meeting",
              eventTitle: "Meeting",
              notes: null,
              fieldResponses: null,
              meetingLink: null,
              meetingLinkPending: true,
              googleEventId: null,
              cancelToken: "cancel-token",
              status: "confirmed",
              createdAt: "2026-08-10T12:00:00.000Z",
            },
          ]),
        })),
      })),
    });

    await expect((getBookingByToken as any)({})).resolves.toMatchObject({
      meetingLinkPending: true,
      status: "confirmed",
    });
  });
});
