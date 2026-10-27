import { describe, expect, it } from "vitest";

import { effectiveEditZones } from "./google-calendar";
import {
  alignSeriesRecurrenceToStart,
  shiftSeriesDateValue,
} from "./series-recurrence";

describe("series date alignment", () => {
  it("preserves all-day date formatting when shifting an occurrence update to the master", () => {
    expect(
      shiftSeriesDateValue(
        "2026-05-08",
        "2026-05-06",
        "2026-05-01",
        "America/New_York",
      ),
    ).toBe("2026-05-03");
  });

  it("preserves non-zero milliseconds for timed event shifts", () => {
    expect(
      shiftSeriesDateValue(
        "2026-05-08T09:00:00.123Z",
        "2026-05-06T09:00:00.123Z",
        "2026-05-01T09:00:00.123Z",
        "Asia/Tokyo",
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

  // Offset-less values must read as wall time in the series zone, not the
  // process zone: these expectations hold under any TZ the suite runs in.
  it("reads offset-less date-times as wall time in the series zone", () => {
    expect(
      shiftSeriesDateValue(
        "2026-05-08T09:00:00",
        "2026-05-06T09:00:00",
        "2026-05-01T09:00:00",
        "Asia/Tokyo",
      ),
    ).toBe("2026-05-03T00:00:00Z");
  });

  it("picks the weekday of an offset-less start in the series zone", () => {
    const aligned = alignSeriesRecurrenceToStart(
      {
        start: "2026-05-07T23:30:00",
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

  it("treats an unrecognised provider zone as no zone when shifting", () => {
    expect(
      shiftSeriesDateValue(
        "2026-05-08T09:00:00.123Z",
        "2026-05-06T09:00:00.123Z",
        "2026-05-01T09:00:00.123Z",
        "Not/AZone",
      ),
    ).toBe("2026-05-03T09:00:00.123Z");
  });

  it("treats an unrecognised provider zone as no zone for the weekday", () => {
    const aligned = alignSeriesRecurrenceToStart(
      {
        start: "2026-05-07T09:00:00Z",
        startTimeZone: "Not/AZone",
      },
      {
        startValue: "2026-05-06T09:00:00Z",
        startTimeZone: "Not/AZone",
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
      },
    );

    expect(aligned.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
  });

  // The edit's offset-less start is wall time in the zone it was typed in
  // (Berlin), not in the master's zone (New York). 07:00Z is 09:00 in Berlin.
  it("reads an offset-less edit start in its own zone when the master is in another zone", () => {
    expect(
      shiftSeriesDateValue(
        "2026-05-04T09:00:00",
        "2026-05-04T10:00:00-04:00",
        "2026-05-01T10:00:00-04:00",
        "America/New_York",
        "Europe/Berlin",
      ),
    ).toBe("2026-05-01T07:00:00Z");
  });

  it("reads an offset-less edit start in the series zone when the edit names no zone", () => {
    expect(
      shiftSeriesDateValue(
        "2026-05-04T09:00:00",
        "2026-05-04T10:00:00-04:00",
        "2026-05-01T10:00:00-04:00",
        "America/New_York",
      ),
    ).toBe("2026-05-01T13:00:00Z");
  });
});

describe("effectiveEditZones", () => {
  const master = {
    start: {
      dateTime: "2026-05-01T10:00:00-04:00",
      timeZone: "America/New_York",
    },
    end: {
      dateTime: "2026-05-01T11:00:00-04:00",
      timeZone: "America/New_York",
    },
  };

  // A one-hour master in New York and an edit that names Berlin for its start
  // only. Both offset-less endpoints are wall time in Berlin, so the one-hour
  // gap has to survive the shift onto the master's New York wall clock.
  it("keeps a one-hour duration when a lone start zone is applied to both endpoints", () => {
    const edit = {
      start: "2026-05-04T09:00:00",
      end: "2026-05-04T10:00:00",
      startTimeZone: "Europe/Berlin",
    };
    const zones = effectiveEditZones(edit, master);
    expect(zones).toEqual({
      startTimeZone: "Europe/Berlin",
      endTimeZone: "Europe/Berlin",
    });

    const start = shiftSeriesDateValue(
      edit.start,
      "2026-05-04T10:00:00-04:00",
      master.start.dateTime,
      master.start.timeZone,
      zones.startTimeZone,
    );
    const end = shiftSeriesDateValue(
      edit.end,
      "2026-05-04T11:00:00-04:00",
      master.end.dateTime,
      master.end.timeZone,
      zones.endTimeZone,
    );
    if (start === undefined || end === undefined) {
      throw new Error("shiftSeriesDateValue dropped an endpoint");
    }
    expect(Date.parse(end) - Date.parse(start)).toBe(60 * 60 * 1000);
  });

  it("applies a lone end zone to both endpoints", () => {
    expect(
      effectiveEditZones({ endTimeZone: "Europe/Berlin" }, master),
    ).toEqual({ startTimeZone: "Europe/Berlin", endTimeZone: "Europe/Berlin" });
  });

  it("keeps each zone when the edit names both", () => {
    expect(
      effectiveEditZones(
        { startTimeZone: "Europe/Berlin", endTimeZone: "Asia/Tokyo" },
        master,
      ),
    ).toEqual({ startTimeZone: "Europe/Berlin", endTimeZone: "Asia/Tokyo" });
  });

  it("falls back to the master's zones only when the edit names neither", () => {
    expect(effectiveEditZones({}, master)).toEqual({
      startTimeZone: "America/New_York",
      endTimeZone: "America/New_York",
    });
  });
});
