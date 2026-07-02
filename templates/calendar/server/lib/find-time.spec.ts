import { describe, expect, it } from "vitest";

import type { FindTimeBusyBlock, FindTimeParticipant } from "../../shared/api";
import {
  computeFindTimeSlots,
  resolveFindTimeRange,
  zonedDateTimeToUtcIso,
} from "./find-time";

const participants: FindTimeParticipant[] = [
  { email: "organizer@example.com", role: "organizer" },
  { email: "guest@example.com", role: "attendee" },
];

function busy(
  participantEmail: string,
  start: string,
  end: string,
): FindTimeBusyBlock {
  return {
    participantEmail,
    start: zonedDateTimeToUtcIso("2026-05-26", start, "America/New_York"),
    end: zonedDateTimeToUtcIso("2026-05-26", end, "America/New_York"),
  };
}

describe("find-time scheduling", () => {
  it("computes shared free slots inside working hours", () => {
    const range = resolveFindTimeRange({
      date: "2026-05-26",
      timezone: "America/New_York",
      now: new Date("2026-05-01T12:00:00.000Z"),
    });

    const slots = computeFindTimeSlots({
      range,
      participants,
      busyBlocks: [
        busy("organizer@example.com", "09:30", "10:00"),
        busy("guest@example.com", "10:30", "11:00"),
      ],
      schedule: {
        sunday: [],
        monday: [],
        tuesday: [{ start: "09:00", end: "12:00" }],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
      },
      durationMinutes: 30,
      slotStepMinutes: 30,
    });

    expect(slots.map((slot) => slot.start)).toEqual([
      zonedDateTimeToUtcIso("2026-05-26", "09:00", "America/New_York"),
      zonedDateTimeToUtcIso("2026-05-26", "10:00", "America/New_York"),
      zonedDateTimeToUtcIso("2026-05-26", "11:00", "America/New_York"),
      zonedDateTimeToUtcIso("2026-05-26", "11:30", "America/New_York"),
    ]);
  });

  it("ignores busy blocks that do not belong to requested participants", () => {
    const range = resolveFindTimeRange({
      date: "2026-05-26",
      timezone: "America/New_York",
      now: new Date("2026-05-01T12:00:00.000Z"),
    });

    const slots = computeFindTimeSlots({
      range,
      participants,
      busyBlocks: [
        busy("non-participant@example.com", "09:00", "12:00"),
        busy("guest@example.com", "10:30", "11:00"),
      ],
      schedule: {
        sunday: [],
        monday: [],
        tuesday: [{ start: "09:00", end: "12:00" }],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
      },
      durationMinutes: 30,
      slotStepMinutes: 30,
    });

    expect(slots.map((slot) => slot.start)).toContain(
      zonedDateTimeToUtcIso("2026-05-26", "09:00", "America/New_York"),
    );
    expect(slots.map((slot) => slot.start)).not.toContain(
      zonedDateTimeToUtcIso("2026-05-26", "10:30", "America/New_York"),
    );
  });

  it("uses the requested timezone when resolving date-only bounds", () => {
    const range = resolveFindTimeRange({
      from: "2026-05-26",
      to: "2026-05-27",
      timezone: "America/Los_Angeles",
      now: new Date("2026-05-01T12:00:00.000Z"),
    });

    expect(range.from).toBe("2026-05-26T07:00:00.000Z");
    expect(range.to).toBe("2026-05-27T07:00:00.000Z");
  });
});
