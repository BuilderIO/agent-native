import { describe, expect, it } from "vitest";

import { parseCalendarSnapshot, parseDateRange } from "./appointment-plan";

describe("parseDateRange", () => {
  it("uses Pacific standard time for an unlabeled January appointment", () => {
    expect(parseDateRange("Appointment | Jan 15, 2026 9am - 9:30am")).toEqual({
      startTime: "2026-01-15T17:00:00.000Z",
      endTime: "2026-01-15T17:30:00.000Z",
    });
  });

  it("uses Pacific daylight time for an unlabeled July appointment", () => {
    expect(parseDateRange("Appointment | Jul 15, 2026 9am - 9:30am")).toEqual({
      startTime: "2026-07-15T16:00:00.000Z",
      endTime: "2026-07-15T16:30:00.000Z",
    });
  });
});

describe("parseCalendarSnapshot", () => {
  it("treats an empty connected calendar as an empty snapshot", () => {
    expect(parseCalendarSnapshot(" \n\t")).toEqual([]);
  });
});
