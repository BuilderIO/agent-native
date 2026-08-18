import type { CalendarEvent } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  getAllDaySpan,
  groupAdjacentAllDayPlacements,
  layoutAllDayEvents,
  partitionAllDayEvents,
} from "./all-day-layout";

const days = Array.from(
  { length: 7 },
  (_, index) => new Date(2026, 6, 5 + index),
);

function event(
  id: string,
  start: string,
  end: string,
  eventType: CalendarEvent["eventType"] = "default",
): CalendarEvent {
  return {
    id,
    title: id,
    description: "",
    start,
    end,
    location: "",
    allDay: true,
    source: "google",
    eventType,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("all-day layout", () => {
  it("renders a Tuesday-through-Thursday event as one span", () => {
    expect(
      getAllDaySpan(event("conference", "2026-07-07", "2026-07-10"), days),
    ).toEqual({ startCol: 2, endCol: 4 });
  });

  it("clips spans at both visible week boundaries", () => {
    expect(
      getAllDaySpan(event("roadshow", "2026-07-03", "2026-07-14"), days),
    ).toEqual({ startCol: 0, endCol: 6 });
  });

  it("places a full-day out-of-office event on its semantic date across timezones", () => {
    const crossTimezoneEvent: CalendarEvent = {
      ...event(
        "ooo",
        "2026-07-17T10:00:00.000Z",
        "2026-07-18T10:00:00.000Z",
        "outOfOffice",
      ),
      allDay: false,
      startTimeZone: "Pacific/Kiritimati",
      endTimeZone: "Pacific/Kiritimati",
    };
    const visibleDays = Array.from(
      { length: 3 },
      (_, index) => new Date(2026, 6, 17 + index),
    );

    expect(getAllDaySpan(crossTimezoneEvent, visibleDays)).toEqual({
      startCol: 1,
      endCol: 1,
    });
  });

  it("places a timed event on the day defined by the pinned timezone", () => {
    const timedEvent: CalendarEvent = {
      ...event(
        "tokyo-evening",
        "2026-07-10T23:00:00.000Z",
        "2026-07-11T02:00:00.000Z",
      ),
      allDay: false,
    };

    expect(
      getAllDaySpan(
        timedEvent,
        [new Date(2026, 6, 10), new Date(2026, 6, 11)],
        "Asia/Tokyo",
      ),
    ).toEqual({ startCol: 1, endCol: 1 });
  });

  it("assigns overlapping spans to deterministic non-overlapping rows", () => {
    const layout = layoutAllDayEvents(
      [
        event("beta", "2026-07-08", "2026-07-11"),
        event("alpha", "2026-07-07", "2026-07-10"),
        event("gamma", "2026-07-10", "2026-07-11"),
      ],
      days,
    );

    expect(layout.rowCount).toBe(2);
    expect(
      Object.fromEntries(
        layout.placements.map((placement) => [
          placement.event.id,
          placement.row,
        ]),
      ),
    ).toEqual({ alpha: 0, beta: 1, gamma: 0 });
  });

  it("partitions working locations away from ordinary all-day events", () => {
    const workingLocation = event(
      "home",
      "2026-07-07",
      "2026-07-08",
      "workingLocation",
    );
    const ordinaryEvent = event("holiday", "2026-07-07", "2026-07-08");

    expect(partitionAllDayEvents([ordinaryEvent, workingLocation])).toEqual({
      workingLocations: [workingLocation],
      regularEvents: [ordinaryEvent],
    });
  });

  it("keeps same-day working locations in separate all-day rows", () => {
    const layout = layoutAllDayEvents(
      [
        event("home", "2026-07-07", "2026-07-08", "workingLocation"),
        event("office", "2026-07-07", "2026-07-08", "workingLocation"),
      ],
      days,
      "America/Los_Angeles",
    );

    expect(layout.rowCount).toBe(2);
    expect(layout.placements.map((placement) => placement.event.id)).toEqual([
      "home",
      "office",
    ]);
  });

  it("groups adjacent placements with the same visual identity", () => {
    const layout = layoutAllDayEvents(
      [
        event("home-mon", "2026-07-06", "2026-07-07", "workingLocation"),
        event("home-tue", "2026-07-07", "2026-07-08", "workingLocation"),
        event("office-wed", "2026-07-08", "2026-07-09", "workingLocation"),
      ],
      days,
    );

    const groups = groupAdjacentAllDayPlacements(
      layout.placements,
      ({ event: placementEvent }) =>
        placementEvent.id.startsWith("home") ? "home" : "office",
    );

    expect(groups.map((group) => group.map(({ event }) => event.id))).toEqual([
      ["home-mon", "home-tue"],
      ["office-wed"],
    ]);
  });

  it("does not join matching placements separated by a visible day", () => {
    const layout = layoutAllDayEvents(
      [
        event("home-mon", "2026-07-06", "2026-07-07", "workingLocation"),
        event("home-wed", "2026-07-08", "2026-07-09", "workingLocation"),
      ],
      days,
    );

    const groups = groupAdjacentAllDayPlacements(
      layout.placements,
      () => "home",
    );

    expect(groups).toHaveLength(2);
  });
});
