import { describe, expect, it } from "vitest";

import { getOutOfOfficeSegment, isOutOfOfficeEvent } from "./out-of-office";

describe("out-of-office display", () => {
  it("recognizes native Google out-of-office events", () => {
    expect(isOutOfOfficeEvent({ eventType: "outOfOffice" })).toBe(true);
    expect(isOutOfOfficeEvent({ eventType: "default" })).toBe(false);
  });

  it("returns the visible portion of a partial-day event", () => {
    expect(
      getOutOfOfficeSegment(
        {
          start: "2026-07-22T09:00:00-04:00",
          end: "2026-07-22T17:00:00-04:00",
        },
        new Date("2026-07-22T12:00:00-04:00"),
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
          start: "2026-07-21T12:00:00-04:00",
          end: "2026-07-23T12:00:00-04:00",
        },
        new Date("2026-07-22T12:00:00-04:00"),
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
          start: "2026-07-22T09:00:00-04:00",
          end: "2026-07-22T17:00:00-04:00",
        },
        new Date("2026-07-23T12:00:00-04:00"),
      ),
    ).toBeNull();
  });
});
