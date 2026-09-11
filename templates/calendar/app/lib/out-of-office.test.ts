import { describe, expect, it } from "vitest";

import {
  fullDayOutOfOfficeCoversDate,
  getFirstVisibleOutOfOfficeDayIndex,
  getOutOfOfficeSegment,
  isFullDayOutOfOfficeEvent,
  isOutOfOfficeEvent,
} from "./out-of-office";

function localIso(day: number, hour: number): string {
  return new Date(2026, 6, day, hour).toISOString();
}

describe("out-of-office display", () => {
  it("recognizes native Google out-of-office events", () => {
    expect(isOutOfOfficeEvent({ eventType: "outOfOffice" })).toBe(true);
    expect(isOutOfOfficeEvent({ eventType: "default" })).toBe(false);
  });

  it("recognizes provider-timed full-day out-of-office events", () => {
    const event = {
      eventType: "outOfOffice" as const,
      allDay: false,
      start: "2026-07-18T00:00:00-04:00",
      end: "2026-07-19T00:00:00-04:00",
      startTimeZone: "America/New_York",
    };

    expect(isFullDayOutOfOfficeEvent(event)).toBe(true);
    expect(fullDayOutOfOfficeCoversDate(event, new Date(2026, 6, 18))).toBe(
      true,
    );
    expect(fullDayOutOfOfficeCoversDate(event, new Date(2026, 6, 17))).toBe(
      false,
    );
  });

  it("recognizes multi-day out-of-office events across DST", () => {
    expect(
      isFullDayOutOfOfficeEvent({
        eventType: "outOfOffice",
        allDay: false,
        start: "2026-10-31T00:00:00-04:00",
        end: "2026-11-02T00:00:00-05:00",
        startTimeZone: "America/New_York",
      }),
    ).toBe(true);
  });

  it("recognizes a full-day event when DST skips local midnight", () => {
    const event = {
      eventType: "outOfOffice" as const,
      allDay: false,
      start: "2026-09-06T04:00:00.000Z",
      end: "2026-09-07T03:00:00.000Z",
      startTimeZone: "America/Santiago",
    };

    expect(isFullDayOutOfOfficeEvent(event)).toBe(true);
    expect(fullDayOutOfOfficeCoversDate(event, new Date(2026, 8, 6))).toBe(
      true,
    );
  });

  it("uses the pinned timezone for a DST-crossing visible segment", () => {
    expect(
      getOutOfOfficeSegment(
        {
          start: "2026-03-08T06:30:00.000Z",
          end: "2026-03-08T08:30:00.000Z",
        },
        new Date(2026, 2, 8, 12),
        "America/New_York",
      ),
    ).toEqual({
      topMinutes: 90,
      durationMinutes: 180,
      startsOnDay: true,
      endsOnDay: true,
    });
  });

  it("keeps partial-day and ordinary midnight events out of the all-day lane", () => {
    expect(
      isFullDayOutOfOfficeEvent({
        eventType: "outOfOffice",
        allDay: false,
        start: "2026-07-18T09:00:00-04:00",
        end: "2026-07-18T17:00:00-04:00",
        startTimeZone: "America/New_York",
      }),
    ).toBe(false);
    expect(
      isFullDayOutOfOfficeEvent({
        eventType: "default",
        allDay: false,
        start: "2026-07-18T00:00:00-04:00",
        end: "2026-07-19T00:00:00-04:00",
        startTimeZone: "America/New_York",
      }),
    ).toBe(false);
  });

  it("returns the visible portion of a partial-day event", () => {
    expect(
      getOutOfOfficeSegment(
        {
          start: localIso(22, 9),
          end: localIso(22, 17),
        },
        new Date(2026, 6, 22, 12),
      ),
    ).toEqual({
      topMinutes: 9 * 60,
      durationMinutes: 8 * 60,
      startsOnDay: true,
      endsOnDay: true,
    });
  });

  it("caps multi-day segments at day boundaries", () => {
    expect(
      getOutOfOfficeSegment(
        {
          start: localIso(21, 12),
          end: localIso(23, 12),
        },
        new Date(2026, 6, 22, 12),
      ),
    ).toEqual({
      topMinutes: 0,
      durationMinutes: 24 * 60,
      startsOnDay: false,
      endsOnDay: false,
    });
  });

  it("returns null outside the event range", () => {
    expect(
      getOutOfOfficeSegment(
        {
          start: localIso(22, 9),
          end: localIso(22, 17),
        },
        new Date(2026, 6, 23, 12),
      ),
    ).toBeNull();
  });

  it("selects one canonical visible segment for multi-day details", () => {
    const event = {
      start: localIso(21, 12),
      end: localIso(24, 12),
    };
    const days = [22, 23, 24].map((day) => new Date(2026, 6, day, 12));

    expect(getFirstVisibleOutOfOfficeDayIndex(event, days)).toBe(0);
  });
});
