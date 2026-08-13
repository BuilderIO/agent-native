import { describe, expect, it } from "vitest";

import type { DaySchedule } from "../../shared/api";
import {
  addTimeSlot,
  availabilitySlotsOverlap,
  normalizeAvailabilitySlots,
  removeTimeSlot,
  updateTimeSlot,
} from "./availability-schedule";

const splitDay: DaySchedule = {
  enabled: true,
  slots: [
    { start: "13:00", end: "16:00" },
    { start: "20:00", end: "23:00" },
  ],
};

describe("availability schedule editing", () => {
  it("updates one interval without dropping the other intervals", () => {
    expect(updateTimeSlot(splitDay, 0, "start", "12:30")).toEqual({
      enabled: true,
      slots: [
        { start: "12:30", end: "16:00" },
        { start: "20:00", end: "23:00" },
      ],
    });
  });

  it("adds a new interval while preserving existing intervals", () => {
    expect(addTimeSlot(splitDay).slots).toEqual([
      { start: "13:00", end: "16:00" },
      { start: "20:00", end: "23:00" },
      { start: "09:00", end: "17:00" },
    ]);
  });

  it("removes only the selected interval", () => {
    expect(removeTimeSlot(splitDay, 0)).toEqual({
      enabled: true,
      slots: [{ start: "20:00", end: "23:00" }],
    });
  });

  it("detects overlapping windows, including exact duplicates", () => {
    expect(
      availabilitySlotsOverlap([
        { start: "09:00", end: "12:00" },
        { start: "09:00", end: "12:00" },
      ]),
    ).toBe(true);
    expect(
      availabilitySlotsOverlap([
        { start: "09:00", end: "12:00" },
        { start: "12:00", end: "17:00" },
      ]),
    ).toBe(false);
  });

  it("merges overlapping windows before slot generation", () => {
    expect(
      normalizeAvailabilitySlots([
        { start: "13:00", end: "16:00" },
        { start: "15:00", end: "18:00" },
        { start: "20:00", end: "23:00" },
      ]),
    ).toEqual([
      { start: "13:00", end: "18:00" },
      { start: "20:00", end: "23:00" },
    ]);
  });
});
