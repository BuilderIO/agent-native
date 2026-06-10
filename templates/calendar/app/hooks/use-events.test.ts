import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@shared/api";
import {
  applyCalendarEventRsvp,
  calendarEventOverlapsListParams,
  mergeCalendarEventIntoList,
  removeOptimisticCalendarEventFromList,
} from "./event-list-cache";
import { shouldShowEventsSkeleton } from "./use-events";

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
    expect(
      calendarEventOverlapsListParams(event, {
        from: "2026-05-22T17:00:00.000Z",
        to: "2026-05-22T18:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      calendarEventOverlapsListParams(event, {
        from: "2026-05-22T15:00:00.000Z",
        to: "2026-05-22T16:00:00.000Z",
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

  it("optimistically updates the event and self attendee RSVP status", () => {
    const event = calendarEvent({
      source: "google",
      accountEmail: "me@example.com",
      responseStatus: "needsAction",
      attendees: [
        {
          email: "guest@example.com",
          displayName: "Guest",
          responseStatus: "accepted",
        },
        {
          email: "me@example.com",
          displayName: "Me",
          responseStatus: "needsAction",
          self: true,
        },
      ],
    });

    const next = applyCalendarEventRsvp(
      [event],
      event.id,
      "declined",
      "single",
      "me@example.com",
      "I have a conflict",
    );

    expect(next?.[0]?.responseStatus).toBe("declined");
    expect(next?.[0]?.attendees?.find((a) => a.self)).toMatchObject({
      responseStatus: "declined",
      comment: "I have a conflict",
    });
    expect(next?.[0]?.attendees?.[0]?.responseStatus).toBe("accepted");
  });

  it("optimistically clears a self attendee RSVP note", () => {
    const event = calendarEvent({
      source: "google",
      accountEmail: "me@example.com",
      responseStatus: "declined",
      attendees: [
        {
          email: "me@example.com",
          displayName: "Me",
          responseStatus: "declined",
          comment: "I have a conflict",
          self: true,
        },
      ],
    });

    const next = applyCalendarEventRsvp(
      [event],
      event.id,
      "accepted",
      "single",
      "me@example.com",
      "",
    );

    expect(next?.[0]?.responseStatus).toBe("accepted");
    expect(next?.[0]?.attendees?.find((a) => a.self)).toMatchObject({
      responseStatus: "accepted",
      comment: undefined,
    });
  });

  it("optimistically updates this and following recurring RSVP instances", () => {
    const past = calendarEvent({
      id: "past",
      recurringEventId: "series-1",
      start: "2026-05-15T16:00:00.000Z",
      end: "2026-05-15T17:00:00.000Z",
      responseStatus: "accepted",
    });
    const target = calendarEvent({
      id: "target",
      recurringEventId: "series-1",
      start: "2026-05-22T16:00:00.000Z",
      end: "2026-05-22T17:00:00.000Z",
      responseStatus: "accepted",
    });
    const future = calendarEvent({
      id: "future",
      recurringEventId: "series-1",
      start: "2026-05-29T16:00:00.000Z",
      end: "2026-05-29T17:00:00.000Z",
      responseStatus: "accepted",
    });
    const otherSeries = calendarEvent({
      id: "other-series",
      recurringEventId: "series-2",
      start: "2026-05-29T16:00:00.000Z",
      end: "2026-05-29T17:00:00.000Z",
      responseStatus: "accepted",
    });

    const next = applyCalendarEventRsvp(
      [past, target, future, otherSeries],
      target.id,
      "tentative",
      "thisAndFollowing",
    );

    expect(next?.map((event) => [event.id, event.responseStatus])).toEqual([
      ["past", "accepted"],
      ["target", "tentative"],
      ["future", "tentative"],
      ["other-series", "accepted"],
    ]);
  });
});

describe("shouldShowEventsSkeleton", () => {
  const week = "2026-05-18T00:00:00.000Z|2026-05-24T23:59:59.999Z";
  const nextWeek = "2026-05-25T00:00:00.000Z|2026-05-31T23:59:59.999Z";

  it("shows the skeleton on the very first load (pending, no data)", () => {
    expect(
      shouldShowEventsSkeleton({
        isLoading: true,
        isPlaceholderData: false,
        settledRangeKey: null,
        rangeKey: week,
      }),
    ).toBe(true);
  });

  it("shows the skeleton when navigating to a new, unfetched date range", () => {
    // keepPreviousData serves last week's events as placeholder while next week
    // loads — showing them in next week's grid would be wrong, so we skeleton.
    expect(
      shouldShowEventsSkeleton({
        isLoading: false,
        isPlaceholderData: true,
        settledRangeKey: week,
        rangeKey: nextWeek,
      }),
    ).toBe(true);
  });

  it("does NOT show the skeleton when only the calendar set changes (the bug)", () => {
    // Removing/adding a feed or person overlay changes the query key but not the
    // date range. keepPreviousData keeps the user's events on screen, so we must
    // keep showing them rather than wiping the calendar behind a skeleton.
    expect(
      shouldShowEventsSkeleton({
        isLoading: false,
        isPlaceholderData: true,
        settledRangeKey: week,
        rangeKey: week,
      }),
    ).toBe(false);
  });

  it("does NOT show the skeleton during a same-range background refetch", () => {
    expect(
      shouldShowEventsSkeleton({
        isLoading: false,
        isPlaceholderData: false,
        settledRangeKey: week,
        rangeKey: week,
      }),
    ).toBe(false);
  });
});
