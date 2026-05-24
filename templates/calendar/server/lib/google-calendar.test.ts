import { describe, expect, it } from "vitest";
import {
  alignSeriesRecurrenceToStart,
  shiftSeriesDateValue,
} from "./series-recurrence";

describe("series date alignment", () => {
  it("preserves all-day date formatting when shifting an occurrence update to the master", () => {
    expect(shiftSeriesDateValue("2026-05-08", "2026-05-06", "2026-05-01")).toBe(
      "2026-05-03",
    );
  });

  it("preserves non-zero milliseconds for timed event shifts", () => {
    expect(
      shiftSeriesDateValue(
        "2026-05-08T09:00:00.123Z",
        "2026-05-06T09:00:00.123Z",
        "2026-05-01T09:00:00.123Z",
      ),
    ).toBe("2026-05-03T09:00:00.123Z");
  });

  it("updates a weekly RRULE when an apply-to-all date shift changes weekday", () => {
    const aligned = alignSeriesRecurrenceToStart(
      {
        start: "2026-05-07T09:00:00+09:00",
        startTimeZone: "Asia/Tokyo",
      },
      {
        startValue: "2026-05-06T09:00:00+09:00",
        startTimeZone: "Asia/Tokyo",
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
      },
    );

    expect(aligned.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
  });

  it("leaves multi-day weekly RRULEs alone when the new weekday is already present", () => {
    const aligned = alignSeriesRecurrenceToStart(
      {
        start: "2026-05-07T09:00:00+09:00",
        startTimeZone: "Asia/Tokyo",
      },
      {
        startValue: "2026-05-06T09:00:00+09:00",
        startTimeZone: "Asia/Tokyo",
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE,TH"],
      },
    );

    expect(aligned.recurrence).toBeUndefined();
  });
});
