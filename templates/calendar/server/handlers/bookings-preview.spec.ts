import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accessFilter: vi.fn(() => undefined),
  createZoomMeeting: vi.fn(),
  getDb: vi.fn(),
  getFreeBusy: vi.fn(),
  getSession: vi.fn(),
  getSetting: vi.fn(),
  getUserSetting: vi.fn(),
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
  deleteEvent: vi.fn(),
  getDefaultAccountSelection: vi.fn(),
  getFreeBusy: mocks.getFreeBusy,
  isConnected: mocks.isConnected,
  listEvents: mocks.listEvents,
}));

vi.mock("../lib/zoom.js", () => ({
  createZoomMeeting: mocks.createZoomMeeting,
}));

import { schema } from "../db/index.js";
import { createBooking, getAvailableSlots } from "./bookings.js";

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

function createDb() {
  const update = vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => ({
      where: vi.fn(async () => {
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
        where: vi.fn(async () =>
          table === schema.bookingLinks ? [bookingLink] : [],
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
    bookingLink.conferencing = undefined;
    // Slot generation drops anything before `Date.now()`, so the Monday this
    // asserts on has to stay in the future or every slot vanishes.
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
    mocks.getFreeBusy.mockResolvedValue({
      calendars: {
        "owner@example.com": { busy: [] },
        "new-host@example.com": { busy: [] },
      },
      errors: [],
    });
    mocks.listEvents.mockResolvedValue({ events: [], errors: [] });
    mocks.verifyCaptcha.mockResolvedValue({ success: true });
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

  it("keeps the booking reserved when Zoom creation has an ambiguous failure", async () => {
    bookingLink.conferencing = JSON.stringify({ type: "zoom" });
    bookingLink.hosts = JSON.stringify([]);
    mocks.createZoomMeeting.mockRejectedValueOnce(
      new Error("response lost after Zoom created the meeting"),
    );
    const event = {};

    const response = await (createBooking as any)(event);

    expect(response).toEqual({ error: "Failed to create booking" });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 502);
    expect(mocks.insertedBookings).toHaveLength(1);
    expect(mocks.insertedBookings[0]).toEqual(
      expect.objectContaining({ status: "confirmed", zoomNeedsReview: true }),
    );

    const retryResponse = await (createBooking as any)({});

    expect(retryResponse).toEqual({
      error: "This time slot is no longer available",
    });
    expect(mocks.createZoomMeeting).toHaveBeenCalledTimes(1);
    expect(mocks.insertedBookings).toHaveLength(1);
  });

  it("releases the slot when Zoom creation never starts", async () => {
    bookingLink.conferencing = JSON.stringify({ type: "zoom" });
    bookingLink.hosts = JSON.stringify([]);
    mocks.createZoomMeeting
      .mockResolvedValueOnce({ status: "not_started" })
      .mockRejectedValueOnce(new Error("ambiguous Zoom failure"));
    const event = {};

    const response = await (createBooking as any)(event);

    expect(response).toEqual({ error: "Failed to create booking" });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 503);
    expect(mocks.insertedBookings).toHaveLength(1);
    expect(mocks.insertedBookings[0]).toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );

    const retryResponse = await (createBooking as any)({});

    expect(retryResponse).toEqual({ error: "Failed to create booking" });
    expect(mocks.createZoomMeeting).toHaveBeenCalledTimes(2);
    expect(mocks.insertedBookings).toHaveLength(2);
    expect(mocks.insertedBookings[1]).toEqual(
      expect.objectContaining({ status: "confirmed" }),
    );
  });
});
