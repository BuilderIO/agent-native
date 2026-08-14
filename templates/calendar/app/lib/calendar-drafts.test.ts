import { describe, expect, it } from "vitest";

import {
  buildWorkingLocationDraft,
  resolveDraftWorkingLocation,
} from "./calendar-drafts";
import { dateKeyToDate } from "./calendar-timezone";

describe("working location drafts", () => {
  it("creates a single-day all-day event by default", () => {
    expect(
      buildWorkingLocationDraft({
        id: "slot-first",
        date: dateKeyToDate("2026-08-14"),
        now: "2026-08-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      start: "2026-08-14",
      end: "2026-08-15",
      allDay: true,
      eventType: "workingLocation",
      workingLocationType: "homeOffice",
      startTimeZone: undefined,
      endTimeZone: undefined,
    });
  });

  it("keeps a date range in exclusive all-day format", () => {
    expect(
      buildWorkingLocationDraft({
        id: "slot-range",
        date: dateKeyToDate("2026-08-31"),
        now: "2026-08-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      start: "2026-08-31",
      end: "2026-09-01",
      allDay: true,
    });
  });

  it("keeps an Other name when location is the empty draft default", () => {
    expect(
      resolveDraftWorkingLocation({
        workingLocationType: "customLocation",
        workingLocationLabel: "Church",
        location: "",
      }),
    ).toEqual({
      workingLocationType: "customLocation",
      workingLocationLabel: "Church",
    });
  });

  it("falls back to location when the Other name was stored there", () => {
    expect(
      resolveDraftWorkingLocation({
        workingLocationType: "customLocation",
        workingLocationLabel: "",
        location: "Library",
      }),
    ).toEqual({
      workingLocationType: "customLocation",
      workingLocationLabel: "Library",
    });
  });
});
