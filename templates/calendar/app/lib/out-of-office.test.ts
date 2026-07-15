import { describe, expect, it } from "vitest";

import {
  getFirstVisibleOutOfOfficeDayIndex,
  getOutOfOfficeSegment,
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
