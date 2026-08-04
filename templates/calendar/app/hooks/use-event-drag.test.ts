import type { CalendarEvent } from "@shared/api";
import { describe, expect, it } from "vitest";

import { resolveDraggedEventTimes } from "./use-event-drag";

const event: CalendarEvent = {
  id: "event-1",
  title: "DST event",
  description: "",
  location: "",
  start: "2026-03-08T06:30:00.000Z",
  end: "2026-03-08T07:30:00.000Z",
  allDay: false,
  source: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("resolveDraggedEventTimes", () => {
  it("preserves elapsed duration when a move crosses a spring-forward gap", () => {
    const times = resolveDraggedEventTimes({
      event,
      mode: "move",
      start: new Date(2026, 2, 8, 1, 30),
      heightMinutes: 60,
      timezone: "America/New_York",
    });

    expect(times.start.toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(times.end.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(times.end.getTime() - times.start.getTime()).toBe(60 * 60_000);
  });
});
