import { describe, expect, it } from "vitest";

import {
  buildRecurrenceRules,
  formatRecurrenceText,
  getEventEndValidationMessage,
  getRecurrencePreset,
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
