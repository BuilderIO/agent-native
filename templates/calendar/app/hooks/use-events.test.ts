import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@shared/api";
import {
  calendarEventOverlapsListParams,
  mergeCalendarEventIntoList,
  removeOptimisticCalendarEventFromList,
} from "./event-list-cache";

function calendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Design review",
    description: "",
    start: "2026-05-22T16:00:00.000Z",
    end: "2026-05-22T17:00:00.000Z",
    location: "",
    allDay: false,
    source: "local",
    createdAt: "2026-05-22T15:00:00.000Z",
    updatedAt: "2026-05-22T15:00:00.000Z",
    ...overrides,
  };
}

describe("calendar event list cache helpers", () => {
  it("matches only list-event ranges overlapping the event", () => {
    const event = calendarEvent();

    expect(
      calendarEventOverlapsListParams(event, {
        from: "2026-05-22T00:00:00.000Z",
        to: "2026-05-22T23:59:59.999Z",
      }),
    ).toBe(true);
    expect(
      calendarEventOverlapsListParams(event, {
        from: "2026-05-23T00:00:00.000Z",
        to: "2026-05-23T23:59:59.999Z",
      }),
    ).toBe(false);
  });

  it("replaces an optimistic event with the created event and keeps the stable temp key", () => {
    const optimisticId = "optimistic_event_123";
    const earlier = calendarEvent({
      id: "event-earlier",
      start: "2026-05-22T14:00:00.000Z",
      end: "2026-05-22T15:00:00.000Z",
    });
    const optimistic = calendarEvent({
      id: optimisticId,
      title: "Pending",
      start: "2026-05-22T18:00:00.000Z",
      end: "2026-05-22T19:00:00.000Z",
    });
    const created = calendarEvent({
      id: "google-created",
      title: "Created",
      start: optimistic.start,
      end: optimistic.end,
      source: "google",
    });

    const next = mergeCalendarEventIntoList(
      [optimistic, earlier],
      created,
      optimisticId,
    );

    expect(next.map((event) => event.id)).toEqual([
      "event-earlier",
      "google-created",
    ]);
    expect(next[1]?._tempId).toBe(optimisticId);
    expect(next[1]?.title).toBe("Created");
  });

  it("removes a failed optimistic event", () => {
    const optimisticId = "optimistic_event_123";
    const next = removeOptimisticCalendarEventFromList(
      [
        calendarEvent({ id: optimisticId }),
        calendarEvent({ id: "event-2", _tempId: optimisticId }),
        calendarEvent({ id: "event-3" }),
      ],
      optimisticId,
    );

    expect(next?.map((event) => event.id)).toEqual(["event-3"]);
  });
});
