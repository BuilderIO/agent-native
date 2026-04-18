import { describe, it, expect } from "vitest";
import { computeAvailableSlots } from "./slots.js";
import type { ScheduleInput } from "./rules.js";

const utc: ScheduleInput = {
  timezone: "UTC",
  weeklyAvailability: [
    { day: 1, intervals: [{ startTime: "09:00", endTime: "17:00" }] }, // Mon
    { day: 2, intervals: [{ startTime: "09:00", endTime: "17:00" }] }, // Tue
    { day: 3, intervals: [{ startTime: "09:00", endTime: "17:00" }] }, // Wed
    { day: 4, intervals: [{ startTime: "09:00", endTime: "17:00" }] }, // Thu
    { day: 5, intervals: [{ startTime: "09:00", endTime: "17:00" }] }, // Fri
  ],
  dateOverrides: [],
};

describe("computeAvailableSlots", () => {
  it("enumerates 30-minute slots across a single day", () => {
    // Mon 2026-04-06 09:00Z → 17:00Z → 16 slots of 30 min
    const slots = computeAvailableSlots({
      duration: 30,
      minimumBookingNotice: 0,
      beforeEventBuffer: 0,
      afterEventBuffer: 0,
      slotInterval: null,
      periodType: "unlimited",
      schedule: utc,
      busy: [],
      rangeStart: new Date("2026-04-06T00:00:00Z"),
      rangeEnd: new Date("2026-04-07T00:00:00Z"),
      now: new Date("2026-04-06T00:00:00Z"),
    });
    expect(slots.length).toBe(16);
    expect(slots[0].start).toBe("2026-04-06T09:00:00.000Z");
    expect(slots[slots.length - 1].end).toBe("2026-04-06T17:00:00.000Z");
  });

  it("respects minimum booking notice", () => {
    const slots = computeAvailableSlots({
      duration: 30,
      minimumBookingNotice: 180, // 3h
      beforeEventBuffer: 0,
      afterEventBuffer: 0,
      slotInterval: null,
      periodType: "unlimited",
      schedule: utc,
      busy: [],
      rangeStart: new Date("2026-04-06T00:00:00Z"),
      rangeEnd: new Date("2026-04-07T00:00:00Z"),
      now: new Date("2026-04-06T10:00:00Z"),
    });
    // now=10:00, +3h → earliest bookable is 13:00
    expect(slots[0].start).toBe("2026-04-06T13:00:00.000Z");
  });

  it("removes slots that conflict with busy intervals", () => {
    const slots = computeAvailableSlots({
      duration: 30,
      minimumBookingNotice: 0,
      beforeEventBuffer: 0,
      afterEventBuffer: 0,
      slotInterval: null,
      periodType: "unlimited",
      schedule: utc,
      busy: [{ start: "2026-04-06T10:00:00Z", end: "2026-04-06T11:30:00Z" }],
      rangeStart: new Date("2026-04-06T00:00:00Z"),
      rangeEnd: new Date("2026-04-07T00:00:00Z"),
      now: new Date("2026-04-06T00:00:00Z"),
    });
    const busy = slots.filter(
      (s) =>
        s.start >= "2026-04-06T10:00:00.000Z" &&
        s.start < "2026-04-06T11:30:00.000Z",
    );
    expect(busy.length).toBe(0);
    // 11:30 slot should still be available (not overlapping)
    expect(
      slots.find((s) => s.start === "2026-04-06T11:30:00.000Z"),
    ).toBeTruthy();
  });

  it("applies before/after buffers", () => {
    const slots = computeAvailableSlots({
      duration: 30,
      minimumBookingNotice: 0,
      beforeEventBuffer: 15,
      afterEventBuffer: 15,
      slotInterval: null,
      periodType: "unlimited",
      schedule: utc,
      busy: [{ start: "2026-04-06T11:00:00Z", end: "2026-04-06T11:30:00Z" }],
      rangeStart: new Date("2026-04-06T00:00:00Z"),
      rangeEnd: new Date("2026-04-07T00:00:00Z"),
      now: new Date("2026-04-06T00:00:00Z"),
    });
    // 10:30 slot + afterBuffer=15 → conflict with 11:00 busy
    expect(
      slots.find((s) => s.start === "2026-04-06T10:30:00.000Z"),
    ).toBeFalsy();
    // 11:30 slot - beforeBuffer=15 → 11:15, conflicts with busy end at 11:30
    expect(
      slots.find((s) => s.start === "2026-04-06T11:30:00.000Z"),
    ).toBeFalsy();
    // 12:00 slot - 15 → 11:45, fully clear of busy interval [11:00, 11:30)
    expect(
      slots.find((s) => s.start === "2026-04-06T12:00:00.000Z"),
    ).toBeTruthy();
  });

  it("honors weekly availability — returns no slots on weekends", () => {
    const slots = computeAvailableSlots({
      duration: 30,
      minimumBookingNotice: 0,
      beforeEventBuffer: 0,
      afterEventBuffer: 0,
      slotInterval: null,
      periodType: "unlimited",
      schedule: utc,
      busy: [],
      // 2026-04-04 is a Saturday
      rangeStart: new Date("2026-04-04T00:00:00Z"),
      rangeEnd: new Date("2026-04-05T00:00:00Z"),
      now: new Date("2026-04-04T00:00:00Z"),
    });
    expect(slots.length).toBe(0);
  });

  it("caps rolling period", () => {
    const slots = computeAvailableSlots({
      duration: 30,
      minimumBookingNotice: 0,
      beforeEventBuffer: 0,
      afterEventBuffer: 0,
      slotInterval: null,
      periodType: "rolling",
      periodDays: 1,
      schedule: utc,
      busy: [],
      rangeStart: new Date("2026-04-06T00:00:00Z"),
      rangeEnd: new Date("2026-04-10T00:00:00Z"),
      now: new Date("2026-04-06T08:00:00Z"),
    });
    // All slots must fall within [now, now+1d]
    for (const s of slots) {
      expect(new Date(s.end).getTime()).toBeLessThanOrEqual(
        new Date("2026-04-07T08:00:00Z").getTime(),
      );
    }
  });

  it("handles DST transition (spring forward) in America/Los_Angeles", () => {
    // 2026-03-08 is the spring-forward date in US; 2am→3am.
    const tz: ScheduleInput = {
      timezone: "America/Los_Angeles",
      weeklyAvailability: [
        { day: 0, intervals: [{ startTime: "09:00", endTime: "17:00" }] }, // Sunday
      ],
      dateOverrides: [],
    };
    const slots = computeAvailableSlots({
      duration: 30,
      minimumBookingNotice: 0,
      beforeEventBuffer: 0,
      afterEventBuffer: 0,
      slotInterval: null,
      periodType: "unlimited",
      schedule: tz,
      busy: [],
      rangeStart: new Date("2026-03-08T00:00:00Z"),
      rangeEnd: new Date("2026-03-09T00:00:00Z"),
      now: new Date("2026-03-08T00:00:00Z"),
    });
    // 9-17 PDT on 2026-03-08 = 16:00 UTC to 00:00 UTC next day → 16 30-min slots
    expect(slots.length).toBeGreaterThanOrEqual(15);
    expect(slots[0].start).toBe("2026-03-08T16:00:00.000Z"); // 9am PDT = 16:00 UTC
  });

  it("respects seats-per-time-slot", () => {
    const seatsTaken = new Map<string, number>([
      ["2026-04-06T09:00:00.000Z", 2],
    ]);
    const slots = computeAvailableSlots({
      duration: 30,
      minimumBookingNotice: 0,
      beforeEventBuffer: 0,
      afterEventBuffer: 0,
      slotInterval: null,
      periodType: "unlimited",
      schedule: utc,
      busy: [],
      rangeStart: new Date("2026-04-06T09:00:00Z"),
      rangeEnd: new Date("2026-04-06T10:00:00Z"),
      now: new Date("2026-04-06T00:00:00Z"),
      seatsPerTimeSlot: 3,
      seatsTaken,
    });
    const slot900 = slots.find((s) => s.start === "2026-04-06T09:00:00.000Z");
    expect(slot900?.seatsRemaining).toBe(1);
  });

  it("respects booking limits (perDay)", () => {
    const slots = computeAvailableSlots({
      duration: 30,
      minimumBookingNotice: 0,
      beforeEventBuffer: 0,
      afterEventBuffer: 0,
      slotInterval: null,
      periodType: "unlimited",
      schedule: utc,
      busy: [],
      bookingLimits: { perDay: 2 },
      bookingCounts: {
        perDay: { "2026-04-06": 2 },
        perWeek: {},
        perMonth: {},
        perYear: {},
      },
      rangeStart: new Date("2026-04-06T00:00:00Z"),
      rangeEnd: new Date("2026-04-07T00:00:00Z"),
      now: new Date("2026-04-06T00:00:00Z"),
      viewerTimezone: "UTC",
    });
    expect(slots.length).toBe(0);
  });

  it("date override blocks day entirely", () => {
    const tz: ScheduleInput = {
      ...utc,
      dateOverrides: [{ date: "2026-04-06", intervals: [] }],
    };
    const slots = computeAvailableSlots({
      duration: 30,
      minimumBookingNotice: 0,
      beforeEventBuffer: 0,
      afterEventBuffer: 0,
      slotInterval: null,
      periodType: "unlimited",
      schedule: tz,
      busy: [],
      rangeStart: new Date("2026-04-06T00:00:00Z"),
      rangeEnd: new Date("2026-04-07T00:00:00Z"),
      now: new Date("2026-04-06T00:00:00Z"),
    });
    expect(slots.length).toBe(0);
  });
});
