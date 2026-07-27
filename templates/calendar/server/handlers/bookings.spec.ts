import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AvailabilityConfig } from "../../shared/api";
import * as googleCalendar from "../lib/google-calendar.js";
import {
  generateAvailableSlotsForDate,
  getConflictItems,
  resolveBookingCalendarAccount,
} from "./bookings";

vi.mock("../lib/google-calendar.js", () => ({
  getFreeBusy: vi.fn(),
  getDefaultAccountSelection: vi.fn(),
  isConnected: vi.fn(),
  listEvents: vi.fn(),
}));

function availabilityConfig(): AvailabilityConfig {
  return {
    timezone: "America/Los_Angeles",
    weeklySchedule: {
      monday: { enabled: true, slots: [{ start: "09:00", end: "12:00" }] },
      tuesday: { enabled: false, slots: [] },
      wednesday: { enabled: false, slots: [] },
      thursday: { enabled: false, slots: [] },
      friday: { enabled: false, slots: [] },
      saturday: { enabled: false, slots: [] },
      sunday: { enabled: false, slots: [] },
    },
    bufferMinutes: 0,
    minNoticeHours: 0,
    maxAdvanceDays: 90,
    slotDurationMinutes: 30,
    bookingPageSlug: "book",
  };
}

describe("booking availability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    vi.mocked(googleCalendar.isConnected).mockResolvedValue(true);
    vi.mocked(googleCalendar.getFreeBusy).mockResolvedValue({
      calendars: {
        "host@example.com": { busy: [] },
      },
      errors: [],
    });
    vi.mocked(googleCalendar.listEvents).mockResolvedValue({
      events: [],
      errors: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("offers 45-minute meetings on 30-minute start intervals", () => {
    const slots = generateAvailableSlotsForDate({
      date: "2026-07-20",
      duration: 45,
      config: availabilityConfig(),
      conflictItems: [],
    });

    expect(
      slots.map((slot) => ({
        start: slot.start,
        end: slot.end,
      })),
    ).toEqual([
      {
        start: "2026-07-20T16:00:00.000Z",
        end: "2026-07-20T16:45:00.000Z",
      },
      {
        start: "2026-07-20T16:30:00.000Z",
        end: "2026-07-20T17:15:00.000Z",
      },
      {
        start: "2026-07-20T17:00:00.000Z",
        end: "2026-07-20T17:45:00.000Z",
      },
      {
        start: "2026-07-20T17:30:00.000Z",
        end: "2026-07-20T18:15:00.000Z",
      },
      {
        start: "2026-07-20T18:00:00.000Z",
        end: "2026-07-20T18:45:00.000Z",
      },
    ]);
  });

  it("offers 60-minute meetings on 30-minute start intervals", () => {
    const slots = generateAvailableSlotsForDate({
      date: "2026-07-20",
      duration: 60,
      config: availabilityConfig(),
      conflictItems: [],
    });

    expect(slots.map((slot) => slot.start)).toEqual([
      "2026-07-20T16:00:00.000Z",
      "2026-07-20T16:30:00.000Z",
      "2026-07-20T17:00:00.000Z",
      "2026-07-20T17:30:00.000Z",
      "2026-07-20T18:00:00.000Z",
    ]);
  });

  it("marks owner availability unavailable when Google is not connected", async () => {
    vi.mocked(googleCalendar.isConnected).mockResolvedValue(false);

    const result = await getConflictItems({
      db: {} as any,
      ownerEmail: "host@example.com",
      hostEmails: ["host@example.com"],
      conflictSlugs: ["meeting-45"],
      rangeStartIso: "2026-07-20T07:00:00.000Z",
      rangeEndIso: "2026-07-21T07:00:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(result).toEqual({
      items: [],
      unavailableReason:
        "Calendar availability unavailable for host@example.com",
    });
    expect(googleCalendar.getFreeBusy).not.toHaveBeenCalled();
  });

  it("marks owner availability unavailable when Google free/busy reports errors, ignoring any listEvents data", async () => {
    vi.mocked(googleCalendar.getFreeBusy).mockResolvedValue({
      calendars: {},
      errors: [{ email: "host@example.com", error: "invalid_grant" }],
    });
    // getConflictItems fetches freeBusy and listEvents in parallel for
    // performance, but the freeBusy-error path must still take priority and
    // discard any listEvents data — even when listEvents "succeeds" with
    // events that would otherwise produce conflict items.
    vi.mocked(googleCalendar.listEvents).mockResolvedValue({
      events: [
        {
          id: "evt-1",
          title: "Should be ignored",
          start: "2026-07-20T15:00:00.000Z",
          end: "2026-07-20T16:00:00.000Z",
          allDay: false,
        } as any,
      ],
      errors: [],
    });

    const result = await getConflictItems({
      db: {} as any,
      ownerEmail: "host@example.com",
      hostEmails: ["host@example.com"],
      conflictSlugs: ["meeting-45"],
      rangeStartIso: "2026-07-20T07:00:00.000Z",
      rangeEndIso: "2026-07-21T07:00:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(result).toEqual({
      items: [],
      unavailableReason:
        "Calendar availability unavailable for host@example.com",
    });
  });

  it("marks owner availability unavailable when Google event listing reports errors", async () => {
    vi.mocked(googleCalendar.listEvents).mockResolvedValue({
      events: [],
      errors: [{ email: "host@example.com", error: "rateLimitExceeded" }],
    });

    const result = await getConflictItems({
      db: {} as any,
      ownerEmail: "host@example.com",
      hostEmails: ["host@example.com"],
      conflictSlugs: ["meeting-45"],
      rangeStartIso: "2026-07-20T07:00:00.000Z",
      rangeEndIso: "2026-07-21T07:00:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(result).toEqual({
      items: [],
      unavailableReason:
        "Calendar availability unavailable for host@example.com",
    });
  });
});

describe("booking calendar account provenance", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses the account stored with the booking event", async () => {
    const account = await resolveBookingCalendarAccount({
      booking: {
        slug: "alice-meeting",
        ownerEmail: "alice@example.com",
        calendarAccountId: "secondary@example.com",
      },
    });

    expect(account).toEqual({
      ownerEmail: "alice@example.com",
      accountEmail: "secondary@example.com",
    });
    expect(googleCalendar.getDefaultAccountSelection).not.toHaveBeenCalled();
  });

  it("falls back to the current default for legacy booking rows", async () => {
    vi.mocked(googleCalendar.getDefaultAccountSelection).mockResolvedValue({
      ownerEmail: "alice@example.com",
      accountEmail: "primary@example.com",
    });

    const account = await resolveBookingCalendarAccount({
      booking: {
        slug: "alice-meeting",
        ownerEmail: "alice@example.com",
        calendarAccountId: null,
      },
    });

    expect(account).toEqual({
      ownerEmail: "alice@example.com",
      accountEmail: "primary@example.com",
    });
    expect(googleCalendar.getDefaultAccountSelection).toHaveBeenCalledWith(
      "alice@example.com",
    );
  });

  it("prefers a resolved booking-link host over a legacy owner placeholder", async () => {
    vi.mocked(googleCalendar.getDefaultAccountSelection).mockResolvedValue({
      ownerEmail: "alice@example.com",
      accountEmail: "primary@example.com",
    });

    await resolveBookingCalendarAccount({
      booking: {
        slug: "alice-meeting",
        ownerEmail: "local@localhost",
        calendarAccountId: null,
      },
      hostEmail: "alice@example.com",
    });

    expect(googleCalendar.getDefaultAccountSelection).toHaveBeenCalledWith(
      "alice@example.com",
    );
  });
});
