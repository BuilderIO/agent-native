import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AvailabilityConfig } from "../../shared/api";
import * as googleCalendar from "../lib/google-calendar.js";
import {
  generateAvailableSlotsForDate,
  getConflictItems,
  parseBookingAvailabilityDraft,
  resolveBookingLinkAvailabilityOverrides,
  resolveBookingCalendarAccount,
  deleteGoogleEventForBooking,
} from "./bookings";

vi.mock("../lib/google-calendar.js", () => ({
  getFreeBusy: vi.fn(),
  getDefaultAccountSelection: vi.fn(),
  getOwnedAccountEmails: vi.fn(),
  isConnected: vi.fn(),
  listEvents: vi.fn(),
  deleteEvent: vi.fn(),
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
    vi.mocked(googleCalendar.getOwnedAccountEmails).mockResolvedValue([
      "viewer@example.com",
    ]);
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

  it("offers no slots for a schedule window entirely inside a spring-forward DST gap", () => {
    // 2026-03-08 is the US spring-forward transition: America/New_York
    // clocks jump from 01:59:59 EST straight to 03:00:00 EDT, so a
    // configured 02:00-03:00 window has no real wall-clock time in it.
    // Pin "now" ahead of the outer beforeEach's July date so the
    // notice/advance-window check doesn't also exclude these March slots.
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const config: AvailabilityConfig = {
      ...availabilityConfig(),
      timezone: "America/New_York",
      weeklySchedule: {
        monday: { enabled: false, slots: [] },
        tuesday: { enabled: false, slots: [] },
        wednesday: { enabled: false, slots: [] },
        thursday: { enabled: false, slots: [] },
        friday: { enabled: false, slots: [] },
        saturday: { enabled: false, slots: [] },
        sunday: { enabled: true, slots: [{ start: "02:00", end: "03:00" }] },
      },
    };

    const slots = generateAvailableSlotsForDate({
      date: "2026-03-08",
      duration: 30,
      config,
      conflictItems: [],
    });

    expect(slots).toEqual([]);
  });

  it("does not offer a slot before the requested start when it falls in a DST gap", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const config: AvailabilityConfig = {
      ...availabilityConfig(),
      timezone: "America/New_York",
      weeklySchedule: {
        monday: { enabled: false, slots: [] },
        tuesday: { enabled: false, slots: [] },
        wednesday: { enabled: false, slots: [] },
        thursday: { enabled: false, slots: [] },
        friday: { enabled: false, slots: [] },
        saturday: { enabled: false, slots: [] },
        sunday: { enabled: true, slots: [{ start: "01:30", end: "04:00" }] },
      },
    };

    const slots = generateAvailableSlotsForDate({
      date: "2026-03-08",
      duration: 30,
      config,
      conflictItems: [],
    });

    // The window's real span is 01:30 EST to 04:00 EDT, i.e. 1.5 real hours
    // (06:30Z-08:00Z) — 3 slots, none of them inside the nonexistent
    // 02:00-03:00 local window.
    expect(slots.map((slot) => ({ start: slot.start, end: slot.end }))).toEqual(
      [
        { start: "2026-03-08T06:30:00.000Z", end: "2026-03-08T07:00:00.000Z" },
        { start: "2026-03-08T07:00:00.000Z", end: "2026-03-08T07:30:00.000Z" },
        { start: "2026-03-08T07:30:00.000Z", end: "2026-03-08T08:00:00.000Z" },
      ],
    );
  });

  it("offers a slot after a non-hour DST gap instead of discarding the window", () => {
    // 2026-10-04 is Australia/Lord_Howe's spring-forward transition, which
    // advances clocks by only 30 minutes (01:59:59 -> 02:30:00), unlike most
    // zones' 60-minute jump. A window starting inside that gap must resolve
    // to the real 30-minute shift, not a hardcoded hour — otherwise the
    // corrected start lands after the window's own (valid) end and the whole
    // window is wrongly discarded.
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const config: AvailabilityConfig = {
      ...availabilityConfig(),
      timezone: "Australia/Lord_Howe",
      weeklySchedule: {
        monday: { enabled: false, slots: [] },
        tuesday: { enabled: false, slots: [] },
        wednesday: { enabled: false, slots: [] },
        thursday: { enabled: false, slots: [] },
        friday: { enabled: false, slots: [] },
        saturday: { enabled: false, slots: [] },
        sunday: { enabled: true, slots: [{ start: "02:00", end: "02:45" }] },
      },
    };

    const slots = generateAvailableSlotsForDate({
      date: "2026-10-04",
      duration: 15,
      config,
      conflictItems: [],
    });

    // Real span is 02:30-02:45 local (15 real minutes) — one 15-minute slot.
    expect(slots.map((slot) => ({ start: slot.start, end: slot.end }))).toEqual(
      [{ start: "2026-10-03T15:30:00.000Z", end: "2026-10-03T15:45:00.000Z" }],
    );
  });

  it("rejects a calendar date that a time zone skipped entirely", () => {
    vi.setSystemTime(new Date("2011-11-01T00:00:00.000Z"));
    const config: AvailabilityConfig = {
      ...availabilityConfig(),
      timezone: "Pacific/Apia",
      weeklySchedule: {
        monday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
        tuesday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
        wednesday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
        thursday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
        friday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
        saturday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
        sunday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
      },
    };

    expect(() =>
      generateAvailableSlotsForDate({
        date: "2011-12-30",
        duration: 30,
        config,
        conflictItems: [],
      }),
    ).toThrow(/does not exist/);
  });

  it("does not discard an otherwise-valid day when a peer's padding day is skipped", () => {
    // The owner's own day (2011-12-31, UTC) is perfectly valid. But scanning
    // a peer host's schedule pads +/-1 day and walks calendar-date strings
    // in the peer's own time zone (Pacific/Apia) to cover it, which passes
    // straight through "2011-12-30" — a date string that zone's whole-day
    // skip has no matching offset for. That padding day should simply
    // contribute no schedule window, not blow up the owner's entire day.
    vi.setSystemTime(new Date("2011-11-01T00:00:00.000Z"));
    const fullWeek = {
      monday: { enabled: true, slots: [{ start: "00:00", end: "23:59" }] },
      tuesday: { enabled: true, slots: [{ start: "00:00", end: "23:59" }] },
      wednesday: { enabled: true, slots: [{ start: "00:00", end: "23:59" }] },
      thursday: { enabled: true, slots: [{ start: "00:00", end: "23:59" }] },
      friday: { enabled: true, slots: [{ start: "00:00", end: "23:59" }] },
      saturday: { enabled: true, slots: [{ start: "00:00", end: "23:59" }] },
      sunday: { enabled: true, slots: [{ start: "00:00", end: "23:59" }] },
    };
    const config: AvailabilityConfig = {
      ...availabilityConfig(),
      timezone: "UTC",
      weeklySchedule: {
        monday: { enabled: false, slots: [] },
        tuesday: { enabled: false, slots: [] },
        wednesday: { enabled: false, slots: [] },
        thursday: { enabled: false, slots: [] },
        friday: { enabled: false, slots: [] },
        saturday: {
          enabled: true,
          slots: [{ start: "09:00", end: "17:00" }],
        },
        sunday: { enabled: false, slots: [] },
      },
    };

    expect(() =>
      generateAvailableSlotsForDate({
        date: "2011-12-31",
        duration: 30,
        config,
        conflictItems: [],
        hostSchedules: [
          {
            email: "peer@example.com",
            timezone: "Pacific/Apia",
            weeklySchedule: fullWeek,
          },
        ],
      }),
    ).not.toThrow();
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

  it("omits slots that overlap existing calendar conflicts", () => {
    const slots = generateAvailableSlotsForDate({
      date: "2026-07-20",
      duration: 30,
      config: availabilityConfig(),
      conflictItems: [
        {
          start: "2026-07-20T16:30:00.000Z",
          end: "2026-07-20T17:30:00.000Z",
        },
      ],
    });

    expect(slots.map((slot) => slot.start)).toEqual([
      "2026-07-20T16:00:00.000Z",
      "2026-07-20T17:30:00.000Z",
      "2026-07-20T18:00:00.000Z",
      "2026-07-20T18:30:00.000Z",
    ]);
  });

  it("offers slots from each disjoint availability window", () => {
    const config = availabilityConfig();
    config.weeklySchedule.monday.slots = [
      { start: "09:00", end: "10:00" },
      { start: "14:00", end: "15:00" },
    ];

    const slots = generateAvailableSlotsForDate({
      date: "2026-07-20",
      duration: 30,
      config,
      conflictItems: [],
    });

    expect(slots.map((slot) => slot.start)).toEqual([
      "2026-07-20T16:00:00.000Z",
      "2026-07-20T16:30:00.000Z",
      "2026-07-20T21:00:00.000Z",
      "2026-07-20T21:30:00.000Z",
    ]);
  });

  it("does not publish duplicate slots from overlapping availability windows", () => {
    const config = availabilityConfig();
    config.weeklySchedule.monday.slots = [
      { start: "09:00", end: "12:00" },
      { start: "11:00", end: "14:00" },
    ];

    const slots = generateAvailableSlotsForDate({
      date: "2026-07-20",
      duration: 60,
      config,
      conflictItems: [],
    });

    expect(new Set(slots.map((slot) => `${slot.start}/${slot.end}`)).size).toBe(
      slots.length,
    );
  });

  it("narrows slots to the overlap with an eligible host schedule", () => {
    const slots = generateAvailableSlotsForDate({
      date: "2026-07-20",
      duration: 30,
      config: availabilityConfig(),
      conflictItems: [],
      hostSchedules: [
        {
          email: "peer@example.com",
          timezone: "America/Los_Angeles",
          weeklySchedule: {
            monday: {
              enabled: true,
              slots: [{ start: "10:00", end: "11:00" }],
            },
            tuesday: { enabled: false, slots: [] },
            wednesday: { enabled: false, slots: [] },
            thursday: { enabled: false, slots: [] },
            friday: { enabled: false, slots: [] },
            saturday: { enabled: false, slots: [] },
            sunday: { enabled: false, slots: [] },
          },
        },
      ],
    });

    expect(slots.map((slot) => slot.start)).toEqual([
      "2026-07-20T17:00:00.000Z",
      "2026-07-20T17:30:00.000Z",
    ]);
  });

  it("returns no slots when an eligible host schedule does not overlap the day", () => {
    const slots = generateAvailableSlotsForDate({
      date: "2026-07-20",
      duration: 30,
      config: availabilityConfig(),
      conflictItems: [],
      hostSchedules: [
        {
          email: "peer@example.com",
          timezone: "America/Los_Angeles",
          weeklySchedule: {
            monday: { enabled: false, slots: [] },
            tuesday: { enabled: false, slots: [] },
            wednesday: { enabled: false, slots: [] },
            thursday: { enabled: false, slots: [] },
            friday: { enabled: false, slots: [] },
            saturday: { enabled: false, slots: [] },
            sunday: { enabled: false, slots: [] },
          },
        },
      ],
    });

    expect(slots).toEqual([]);
  });

  it("leaves slots unchanged for a host with no saved schedule", () => {
    const withoutHost = generateAvailableSlotsForDate({
      date: "2026-07-20",
      duration: 45,
      config: availabilityConfig(),
      conflictItems: [],
    });
    const withUnscheduledHost = generateAvailableSlotsForDate({
      date: "2026-07-20",
      duration: 45,
      config: availabilityConfig(),
      conflictItems: [],
      hostSchedules: [{ email: "peer@example.com" }],
    });

    expect(withUnscheduledHost).toEqual(withoutHost);
  });

  it("marks availability unavailable when the owner has not connected Google", async () => {
    vi.mocked(googleCalendar.isConnected).mockResolvedValue(false);
    const existingBooking = {
      start: "2026-07-20T16:00:00.000Z",
      end: "2026-07-20T16:30:00.000Z",
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([existingBooking]),
        }),
      }),
    } as any;

    const result = await getConflictItems({
      db,
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
    expect(googleCalendar.listEvents).not.toHaveBeenCalled();
  });

  it("includes a same-org viewer's calendar and booking conflicts", async () => {
    vi.mocked(googleCalendar.listEvents)
      .mockResolvedValueOnce({ events: [], errors: [] })
      .mockResolvedValueOnce({
        events: [
          {
            start: "2026-07-20T17:00:00.000Z",
            end: "2026-07-20T17:30:00.000Z",
          } as any,
        ],
        errors: [],
      });
    const db = {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                start: "2026-07-20T18:00:00.000Z",
                end: "2026-07-20T18:30:00.000Z",
              },
            ]),
        }),
      }),
    } as any;

    const result = await getConflictItems({
      db,
      ownerEmail: "host@example.com",
      hostEmails: ["host@example.com"],
      conflictSlugs: ["meeting-45"],
      viewerEmail: "viewer@example.com",
      viewerOrgId: "org-1",
      rangeStartIso: "2026-07-20T07:00:00.000Z",
      rangeEndIso: "2026-07-21T07:00:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(result).toEqual({
      items: [
        {
          start: "2026-07-20T17:00:00.000Z",
          end: "2026-07-20T17:30:00.000Z",
        },
        {
          start: "2026-07-20T18:00:00.000Z",
          end: "2026-07-20T18:30:00.000Z",
        },
      ],
    });
    expect(googleCalendar.getOwnedAccountEmails).toHaveBeenCalledWith(
      "viewer@example.com",
    );
    expect(googleCalendar.listEvents).toHaveBeenLastCalledWith(
      "2026-07-20T07:00:00.000Z",
      "2026-07-21T07:00:00.000Z",
      "viewer@example.com",
      { accountEmails: ["viewer@example.com"] },
    );
  });

  it("does not use a managed calendar as a viewer's personal conflict source", async () => {
    vi.mocked(googleCalendar.getOwnedAccountEmails).mockResolvedValue([]);
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as any;

    const result = await getConflictItems({
      db,
      ownerEmail: "host@example.com",
      hostEmails: ["host@example.com"],
      conflictSlugs: ["meeting-45"],
      viewerEmail: "viewer@example.com",
      viewerOrgId: "org-1",
      rangeStartIso: "2026-07-20T07:00:00.000Z",
      rangeEndIso: "2026-07-21T07:00:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(result).toEqual({ items: [] });
    expect(googleCalendar.listEvents).toHaveBeenCalledTimes(1);
  });

  it("marks availability unavailable when a Google calendar response contains a per-calendar error", async () => {
    vi.mocked(googleCalendar.getFreeBusy).mockResolvedValue({
      calendars: {
        "host@example.com": {
          busy: [],
          errors: [{ reason: "notFound" }],
        },
      },
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

  it("applies draft durations and co-hosts to preview availability", () => {
    const parsed = parseBookingAvailabilityDraft(
      JSON.stringify({
        slug: "updated-meeting",
        durations: [45, 60],
        hosts: [{ email: "new-host@example.com" }],
      }),
    );
    expect("draft" in parsed).toBe(true);
    if (!("draft" in parsed)) return;

    const overrides = resolveBookingLinkAvailabilityOverrides({
      bookingLink: {
        ownerEmail: "owner@example.com",
        hosts: JSON.stringify([{ email: "old-host@example.com" }]),
        duration: 30,
        durations: JSON.stringify([30]),
      } as Parameters<
        typeof resolveBookingLinkAvailabilityOverrides
      >[0]["bookingLink"],
      draft: parsed.draft,
    });

    expect(overrides.hostEmails).toEqual([
      "owner@example.com",
      "new-host@example.com",
    ]);
    expect(overrides.durationSource).toEqual({
      duration: 45,
      durations: "[45,60]",
    });
  });

  it("rejects malformed draft preview payloads", () => {
    expect(parseBookingAvailabilityDraft("not-json")).toEqual({
      error: "draft must be valid JSON",
    });
    expect(
      parseBookingAvailabilityDraft(
        JSON.stringify({ slug: "meeting", durations: [], hosts: [] }),
      ),
    ).toEqual({ error: "draft has an invalid booking-link configuration" });
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

describe("booking cancellation provider notifications", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends Google cancellation updates to every booking attendee", async () => {
    vi.mocked(googleCalendar.deleteEvent).mockResolvedValue();

    await deleteGoogleEventForBooking({
      booking: {
        id: "booking-1",
        slug: "alice-meeting",
        googleEventId: "event-1",
        ownerEmail: "alice@example.com",
        calendarAccountId: "primary@example.com",
      },
    });

    expect(googleCalendar.deleteEvent).toHaveBeenCalledWith(
      "event-1",
      {
        ownerEmail: "alice@example.com",
        accountEmail: "primary@example.com",
      },
      { sendUpdates: "all" },
    );
  });
});
