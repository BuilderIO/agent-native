import { describe, expect, it } from "vitest";

import {
  endOfDayInZone,
  taskScheduleCron,
} from "../../../actions/create-scheduled-task";

// The dialog's end date is a calendar date in the task's own timezone; a run on
// that day is still allowed, and nothing after it is.
describe("task end date", () => {
  it("ends at the last moment of that date in the task's zone", () => {
    expect(endOfDayInZone("2026-12-01", "UTC")).toBe(
      "2026-12-01T23:59:59.000Z",
    );
    // Two hours behind UTC, so the same local day ends later in UTC.
    expect(endOfDayInZone("2026-12-01", "America/Los_Angeles")).toBe(
      "2026-12-02T07:59:59.000Z",
    );
  });

  it("refuses a value that is not a calendar date", () => {
    expect(() => endOfDayInZone("next tuesday", "UTC")).toThrow(
      /calendar date/i,
    );
  });

  it("keeps building the cron from the cadence", () => {
    expect(
      taskScheduleCron({
        cadence: "weekly",
        hour: 9,
        minute: 30,
        dayOfWeek: 1,
      }),
    ).toBe("30 9 * * 1");
  });
});
