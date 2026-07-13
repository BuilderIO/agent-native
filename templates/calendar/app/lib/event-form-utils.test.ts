import { describe, expect, it } from "vitest";

import {
  buildRecurrenceRules,
  formatRecurrenceText,
  getEventEndValidationMessage,
  getRecurrencePreset,
  normalizeAllDayEditEndDate,
  resolveTimeEditScope,
} from "./event-form-utils";

describe("getEventEndValidationMessage", () => {
  it("clarifies equal timed start and end values", () => {
    expect(
      getEventEndValidationMessage({
        allDay: false,
        startDate: "2026-05-12",
        endDate: "2026-05-12",
        startTime: "09:00",
        endTime: "09:00",
      }),
    ).toBe("End time must be later than start time.");
  });

  it("uses date wording for all-day events", () => {
    expect(
      getEventEndValidationMessage({
        allDay: true,
        startDate: "2026-05-12",
        endDate: "2026-05-11",
      }),
    ).toBe("End date must be on or after the start date.");
  });
});

describe("normalizeAllDayEditEndDate", () => {
  it("keeps working-location edits to exactly one day", () => {
    expect(normalizeAllDayEditEndDate(true, "2026-07-08", "2026-07-10")).toBe(
      "2026-07-08",
    );
  });

  it("preserves ranges for ordinary all-day events", () => {
    expect(normalizeAllDayEditEndDate(false, "2026-07-08", "2026-07-10")).toBe(
      "2026-07-10",
    );
  });
});

describe("resolveTimeEditScope", () => {
  it("pins single-day working-location edits to one occurrence", () => {
    expect(resolveTimeEditScope(true, true, "all")).toBe("single");
  });

  it("preserves the requested scope for ordinary recurring events", () => {
    expect(resolveTimeEditScope(true, false, "all")).toBe("all");
  });

  it("uses single scope for non-recurring events", () => {
    expect(resolveTimeEditScope(false, false, "all")).toBe("single");
  });
});

describe("recurrence helpers", () => {
  it("formats common recurrence rules", () => {
    expect(formatRecurrenceText(["RRULE:FREQ=DAILY"])).toBe("Every day");
    expect(
      formatRecurrenceText(["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"]),
    ).toBe("Every week on Mon, Tue, Wed, Thu, Fri");
  });

  it("detects presets from Google RRULE values", () => {
    expect(getRecurrencePreset(["RRULE:FREQ=MONTHLY"])).toBe("monthly");
    expect(getRecurrencePreset(["RRULE:FREQ=WEEKLY;INTERVAL=2"])).toBe(
      "custom",
    );
  });

  it("builds weekly rules using the event start day", () => {
    expect(buildRecurrenceRules("weekly", "2026-05-20T16:00:00.000Z")).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=WE",
    ]);
  });

  it("builds weekly rules using the event timezone", () => {
    expect(
      buildRecurrenceRules("weekly", "2026-05-17T15:30:00.000Z", "Asia/Tokyo"),
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
  });
});
