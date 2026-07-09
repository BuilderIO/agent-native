import type { CalendarEvent } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  getAllDaySpan,
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
});
