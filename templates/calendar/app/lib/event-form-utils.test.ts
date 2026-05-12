import { describe, expect, it } from "vitest";
import { getEventEndValidationMessage } from "./event-form-utils";

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
