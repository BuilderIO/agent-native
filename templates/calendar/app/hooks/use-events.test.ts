import type { CalendarEvent } from "@shared/api";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { getCalendarEventSourceIdentity } from "@/lib/calendar-event-identity";

import {
  applyCalendarEventRsvp,
  calendarEventOverlapsListParams,
  findCalendarEventById,
  getRemovedCalendarEvents,
  mergeCalendarEventIntoList,
  removeCalendarEventsForScope,
  removeOptimisticCalendarEventFromList,
  restoreMissingCalendarEvents,
} from "./event-list-cache";
import {
  findEventByCurrentOrReplacedId,
  findVisibleSelectedEvent,
  getOptimisticTitleIsGenerated,
  mergeAttendeeLists,
  reconcileUpdatedEventList,
  shouldDeferOptimisticEventUpdate,
  shouldShowEventsSkeleton,
  updateListEventQueries,
} from "./use-events";

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
  it("drops a selected declined event when the preference is turned off", () => {
    const declined = calendarEvent({ responseStatus: "declined" });

    expect(findVisibleSelectedEvent([], declined, true)).toBe(declined);
    expect(findVisibleSelectedEvent([], declined, false)).toBeUndefined();
  });

  it("preserves generated provenance when an optimistic display title is nonempty", () => {
    expect(
      getOptimisticTitleIsGenerated({
        title: "Out of office",
        titleIsGenerated: true,
      }),
    ).toBe(true);
    expect(getOptimisticTitleIsGenerated({ title: "Out of office" })).toBe(
      false,
    );
  });

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

  it("does not replace a same-ID event from another Google account", () => {
    const otherAccount = calendarEvent({
      id: "shared-provider-id",
      title: "Other account",
      source: "google",
      accountEmail: "other@example.com",
    });
    const created = calendarEvent({
      id: otherAccount.id,
      title: "Created here",
      source: "google",
      accountEmail: "me@example.com",
    });

    expect(mergeCalendarEventIntoList([otherAccount], created)).toEqual([
      otherAccount,
      created,
    ]);
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

  it("optimistically removes a recurring event at the selected scope", () => {
    const localFeed = { source: "local" as const, sourceId: "local-feed" };
    const past = calendarEvent({
      ...localFeed,
      id: "past",
      recurringEventId: "series-1",
      start: "2026-05-15T16:00:00.000Z",
    });
    const target = calendarEvent({
      ...localFeed,
      id: "target",
      recurringEventId: "series-1",
      start: "2026-05-22T16:00:00.000Z",
    });
    const future = calendarEvent({
      ...localFeed,
      id: "future",
      recurringEventId: "series-1",
      start: "2026-05-29T16:00:00.000Z",
    });
    const otherSeries = calendarEvent({
      ...localFeed,
      id: "other-series",
      recurringEventId: "series-2",
      start: "2026-05-29T16:00:00.000Z",
    });
    const otherLocalFeed = calendarEvent({
      id: "other-local-feed",
      source: "local",
      sourceId: "other-local-feed",
      recurringEventId: "series-1",
      start: "2026-05-29T16:00:00.000Z",
    });
    const missingLocalFeedIdentity = calendarEvent({
      id: "missing-local-feed-identity",
      source: "local",
      recurringEventId: "series-1",
      start: "2026-05-29T16:00:00.000Z",
    });
    const events = [
      past,
      target,
      future,
      otherSeries,
      otherLocalFeed,
      missingLocalFeedIdentity,
    ];

    expect(
      removeCalendarEventsForScope(events, target.id, "single")?.map(
        (event) => event.id,
      ),
    ).toEqual([
      "past",
      "future",
      "other-series",
      "other-local-feed",
      "missing-local-feed-identity",
    ]);
    expect(
      removeCalendarEventsForScope(events, target.id, "thisAndFollowing")?.map(
        (event) => event.id,
      ),
    ).toEqual([
      "past",
      "other-series",
      "other-local-feed",
      "missing-local-feed-identity",
    ]);
    expect(
      removeCalendarEventsForScope(events, target.id, "all")?.map(
        (event) => event.id,
      ),
    ).toEqual([
      "other-series",
      "other-local-feed",
      "missing-local-feed-identity",
    ]);
  });

  it("uses the selected occurrence to filter other cached ranges without crossing accounts", () => {
    const past = calendarEvent({
      id: "past",
      recurringEventId: "series-1",
      start: "2026-05-15T16:00:00.000Z",
      source: "google",
      accountEmail: "me@example.com",
      calendarSourceKey: "calendar-one",
    });
    const target = calendarEvent({
      id: "target",
      recurringEventId: "series-1",
      start: "2026-05-22T16:00:00.000Z",
      source: "google",
      accountEmail: "me@example.com",
      calendarSourceKey: "calendar-one",
    });
    const future = calendarEvent({
      id: "future",
      recurringEventId: "series-1",
      start: "2026-05-29T16:00:00.000Z",
      source: "google",
      accountEmail: "me@example.com",
      calendarSourceKey: "calendar-one",
    });
    const otherAccountSeries = calendarEvent({
      id: "other-account",
      recurringEventId: "series-1",
      start: future.start,
      source: "google",
      accountEmail: "other@example.com",
      calendarSourceKey: "calendar-two",
    });
    const otherAccountSameId = calendarEvent({
      id: target.id,
      recurringEventId: "series-1",
      source: "google",
      accountEmail: "other@example.com",
      calendarSourceKey: "calendar-two",
    });
    const cachedRanges = [
      [past],
      [target],
      [future, otherAccountSeries, otherAccountSameId],
    ];
    const selected = findEventByCurrentOrReplacedId(
      cachedRanges.flat(),
      target,
    );

    expect(selected).toBe(target);
    expect(
      cachedRanges.map((range) =>
        removeCalendarEventsForScope(range, target.id, "all", selected)?.map(
          (event) => event.id,
        ),
      ),
    ).toEqual([[], [], ["other-account", "target"]]);
    expect(
      cachedRanges.map((range) =>
        removeCalendarEventsForScope(
          range,
          target.id,
          "thisAndFollowing",
          selected,
        )?.map((event) => event.id),
      ),
    ).toEqual([["past"], [], ["other-account", "target"]]);
  });

  it("requires feed and overlay identities when filtering recurring cache ranges", () => {
    const targetFeedEvent = calendarEvent({
      id: "feed-target",
      source: "ical",
      sourceId: "team-feed",
      recurringEventId: "shared-series",
    });
    const sameFeedEvent = calendarEvent({
      id: "same-feed",
      source: "ical",
      sourceId: "team-feed",
      recurringEventId: "shared-series",
    });
    const otherFeedEvent = calendarEvent({
      id: "other-feed",
      source: "ical",
      sourceId: "personal-feed",
      recurringEventId: "shared-series",
    });
    const missingFeedIdentity = calendarEvent({
      id: "missing-feed-identity",
      source: "ical",
      recurringEventId: "shared-series",
    });
    const feedRanges = [
      [targetFeedEvent],
      [sameFeedEvent, otherFeedEvent, missingFeedIdentity],
    ];

    expect(
      feedRanges.map((range) =>
        removeCalendarEventsForScope(
          range,
          targetFeedEvent.id,
          "all",
          targetFeedEvent,
        )?.map((event) => event.id),
      ),
    ).toEqual([[], ["other-feed", "missing-feed-identity"]]);

    const targetOverlay = calendarEvent({
      id: "overlay-target",
      source: "google",
      overlayEmail: "person@example.com",
      recurringEventId: "overlay-series",
    });
    const sameOverlayEvent = calendarEvent({
      id: "same-overlay",
      source: "google",
      overlayEmail: "PERSON@example.com",
      recurringEventId: "overlay-series",
    });
    const otherOverlayEvent = calendarEvent({
      id: "other-overlay",
      source: "google",
      overlayEmail: "other@example.com",
      recurringEventId: "overlay-series",
    });
    const missingOverlayIdentity = calendarEvent({
      id: "missing-overlay-identity",
      source: "google",
      accountEmail: "reader@example.com",
      calendarSourceKey: "reader-primary",
      recurringEventId: "overlay-series",
    });
    const overlayRanges = [
      [targetOverlay],
      [sameOverlayEvent, otherOverlayEvent, missingOverlayIdentity],
    ];

    expect(
      overlayRanges.map((range) =>
        removeCalendarEventsForScope(
          range,
          targetOverlay.id,
          "all",
          targetOverlay,
        )?.map((event) => event.id),
      ),
    ).toEqual([[], ["other-overlay", "missing-overlay-identity"]]);

    const unscopedLocalTarget = calendarEvent({
      id: "unscoped-local-target",
      source: "local",
      recurringEventId: "unscoped-local-series",
    });
    const unscopedLocalOccurrence = calendarEvent({
      id: "unscoped-local-occurrence",
      source: "local",
      recurringEventId: "unscoped-local-series",
    });

    expect(
      removeCalendarEventsForScope(
        [unscopedLocalTarget, unscopedLocalOccurrence],
        unscopedLocalTarget.id,
        "all",
        unscopedLocalTarget,
      )?.map((event) => event.id),
    ).toEqual(["unscoped-local-occurrence"]);
  });

  it("uses normalized account identity for primary Google recurring cache ranges", () => {
    const target = calendarEvent({
      id: "primary-target",
      source: "google",
      accountEmail: "Me@example.com",
      recurringEventId: "primary-series",
      start: "2026-05-22T16:00:00.000Z",
    });
    const past = calendarEvent({
      id: "primary-past",
      source: "google",
      accountEmail: " me@example.com ",
      recurringEventId: "primary-series",
      start: "2026-05-15T16:00:00.000Z",
    });
    const future = calendarEvent({
      id: "primary-future",
      source: "google",
      accountEmail: "ME@example.com",
      recurringEventId: "primary-series",
      start: "2026-05-29T16:00:00.000Z",
    });
    const otherAccount = calendarEvent({
      id: "other-account",
      source: "google",
      accountEmail: "other@example.com",
      recurringEventId: "primary-series",
      start: future.start,
    });
    const ranges = [[target], [past, future, otherAccount]];

    expect(
      ranges.map((range) =>
        removeCalendarEventsForScope(range, target.id, "all", target)?.map(
          (event) => event.id,
        ),
      ),
    ).toEqual([[], ["other-account"]]);
    expect(
      ranges.map((range) =>
        removeCalendarEventsForScope(
          range,
          target.id,
          "thisAndFollowing",
          target,
        )?.map((event) => event.id),
      ),
    ).toEqual([[], ["primary-past", "other-account"]]);
  });

  it("rolls back only missing deleted events without overwriting newer cache data", () => {
    const removed = calendarEvent({ id: "target", title: "Original" });
    const updated = calendarEvent({ id: "target", title: "Updated" });
    const other = calendarEvent({ id: "other" });

    expect(restoreMissingCalendarEvents([other], [removed])).toEqual([
      other,
      removed,
    ]);
    expect(restoreMissingCalendarEvents([updated, other], [removed])).toEqual([
      updated,
      other,
    ]);
    expect(restoreMissingCalendarEvents(undefined, [removed])).toEqual([
      removed,
    ]);
  });

  it("tracks delete rollback by event occurrence when account IDs collide", () => {
    const target = calendarEvent({
      id: "shared-provider-id",
      source: "google",
      accountEmail: "me@example.com",
    });
    const otherAccount = calendarEvent({
      id: target.id,
      source: "google",
      accountEmail: "other@example.com",
    });
    const selected = findCalendarEventById(
      [target, otherAccount],
      target.id,
      " ME@example.com ",
    );
    const remaining = removeCalendarEventsForScope(
      [target, otherAccount],
      target.id,
      "single",
      selected,
      target.accountEmail,
    );
    const removed = getRemovedCalendarEvents([target, otherAccount], remaining);

    expect(selected).toBe(target);
    expect(remaining).toEqual([otherAccount]);
    expect(removed).toEqual([target]);
    expect(restoreMissingCalendarEvents(remaining, removed)).toEqual([
      otherAccount,
      target,
    ]);
  });

  it("targets the selected calendar when one account has duplicate event IDs", () => {
    const firstCalendar = calendarEvent({
      id: "shared-provider-id",
      source: "google",
      sourceId: "google-connection",
      accountEmail: "me@example.com",
      calendarSourceKey: "calendar-one",
      calendarId: "calendar-one-id",
      title: "First calendar",
      responseStatus: "accepted",
    });
    const selected = calendarEvent({
      id: firstCalendar.id,
      source: "google",
      sourceId: "google-connection",
      accountEmail: "ME@example.com",
      calendarSourceKey: "calendar-two",
      calendarId: "calendar-two-id",
      title: "Selected calendar",
      responseStatus: "accepted",
    });
    const events = [firstCalendar, selected];
    const identity = getCalendarEventSourceIdentity(selected)!;
    expect(
      findCalendarEventById(events, selected.id, selected.accountEmail),
    ).toBeUndefined();
    const target = findCalendarEventById(events, selected.id, identity);

    expect(target).toBe(selected);
    expect(
      reconcileUpdatedEventList(
        events,
        selected.id,
        { id: selected.id, title: "Updated selected calendar" },
        selected.accountEmail,
        identity,
      ),
    ).toEqual([
      firstCalendar,
      { ...selected, title: "Updated selected calendar" },
    ]);

    expect(
      applyCalendarEventRsvp(
        events,
        selected.id,
        "declined",
        "single",
        selected.accountEmail,
        undefined,
        identity,
      ),
    ).toEqual([
      firstCalendar,
      {
        ...selected,
        responseStatus: "declined",
        updatedAt: expect.any(String),
      },
    ]);

    expect(
      removeCalendarEventsForScope(
        events,
        selected.id,
        "single",
        target,
        selected.accountEmail,
      ),
    ).toEqual([firstCalendar]);
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

  it("scopes optimistic RSVP updates to the selected account when IDs collide", () => {
    const otherAccountTarget = calendarEvent({
      id: "shared-provider-id",
      source: "google",
      accountEmail: "other@example.com",
      recurringEventId: "shared-series",
      responseStatus: "accepted",
    });
    const otherAccountFuture = calendarEvent({
      id: "other-future",
      source: "google",
      accountEmail: "other@example.com",
      recurringEventId: "shared-series",
      responseStatus: "accepted",
    });
    const target = calendarEvent({
      id: otherAccountTarget.id,
      source: "google",
      accountEmail: "me@example.com",
      recurringEventId: "shared-series",
      responseStatus: "accepted",
    });
    const future = calendarEvent({
      id: "future",
      source: "google",
      accountEmail: "me@example.com",
      recurringEventId: "shared-series",
      responseStatus: "accepted",
    });
    const events = [otherAccountTarget, otherAccountFuture, target, future];

    expect(
      applyCalendarEventRsvp(
        events,
        target.id,
        "declined",
        "all",
        " ME@example.com ",
      )?.map((event) => event.responseStatus),
    ).toEqual(["accepted", "accepted", "declined", "declined"]);
    expect(applyCalendarEventRsvp(events, target.id, "declined", "all")).toBe(
      events,
    );
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

  it("merges added attendees without resetting existing RSVP metadata", () => {
    const merged = mergeAttendeeLists(
      [
        {
          email: "guest@example.com",
          displayName: "Guest",
          responseStatus: "accepted",
          comment: "See you there",
          optional: true,
        },
      ],
      [
        {
          email: "new@example.com",
          displayName: "New Guest",
          optional: true,
        },
        {
          email: "GUEST@example.com",
          displayName: "Renamed Guest",
        },
      ],
    );

    expect(merged).toEqual([
      {
        email: "GUEST@example.com",
        displayName: "Renamed Guest",
        responseStatus: "accepted",
        comment: "See you there",
        optional: true,
      },
      {
        email: "new@example.com",
        displayName: "New Guest",
        optional: true,
      },
    ]);
  });

  it("lets addAttendees flip optional without clearing RSVP metadata", () => {
    const merged = mergeAttendeeLists(
      [
        {
          email: "guest@example.com",
          responseStatus: "accepted",
          comment: "See you there",
        },
      ],
      [
        {
          email: "guest@example.com",
          optional: true,
        },
      ],
    );

    expect(merged).toEqual([
      {
        email: "guest@example.com",
        responseStatus: "accepted",
        comment: "See you there",
        optional: true,
      },
    ]);
  });

  it("optimistically updates this and following recurring RSVP instances", () => {
    const googleCalendar = {
      source: "google" as const,
      accountEmail: "Me@example.com",
    };
    const past = calendarEvent({
      ...googleCalendar,
      id: "past",
      recurringEventId: "series-1",
      start: "2026-05-15T16:00:00.000Z",
      end: "2026-05-15T17:00:00.000Z",
      responseStatus: "accepted",
    });
    const target = calendarEvent({
      ...googleCalendar,
      id: "target",
      recurringEventId: "series-1",
      start: "2026-05-22T16:00:00.000Z",
      end: "2026-05-22T17:00:00.000Z",
      responseStatus: "accepted",
    });
    const future = calendarEvent({
      ...googleCalendar,
      accountEmail: " me@example.com ",
      id: "future",
      recurringEventId: "series-1",
      start: "2026-05-29T16:00:00.000Z",
      end: "2026-05-29T17:00:00.000Z",
      responseStatus: "accepted",
    });
    const otherSeries = calendarEvent({
      ...googleCalendar,
      id: "other-series",
      recurringEventId: "series-2",
      start: "2026-05-29T16:00:00.000Z",
      end: "2026-05-29T17:00:00.000Z",
      responseStatus: "accepted",
    });
    const otherAccountSeries = calendarEvent({
      id: "other-account",
      source: "google",
      accountEmail: "other@example.com",
      recurringEventId: "series-1",
      start: "2026-05-29T16:00:00.000Z",
      end: "2026-05-29T17:00:00.000Z",
      responseStatus: "accepted",
    });

    const next = applyCalendarEventRsvp(
      [past, target, future, otherSeries, otherAccountSeries],
      target.id,
      "tentative",
      "thisAndFollowing",
    );

    expect(next?.map((event) => [event.id, event.responseStatus])).toEqual([
      ["past", "accepted"],
      ["target", "tentative"],
      ["future", "tentative"],
      ["other-series", "accepted"],
      ["other-account", "accepted"],
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

describe("shouldDeferOptimisticEventUpdate", () => {
  it("waits for Google before moving a working-location event", () => {
    const event = calendarEvent({ eventType: "workingLocation", allDay: true });

    expect(shouldDeferOptimisticEventUpdate(event, false)).toBe(true);
  });

  it("keeps timed working-location moves optimistic", () => {
    const event = calendarEvent({
      eventType: "workingLocation",
      allDay: false,
    });

    expect(shouldDeferOptimisticEventUpdate(event, false)).toBe(false);
  });

  it("waits for provider confirmation for working-location detail changes", () => {
    expect(shouldDeferOptimisticEventUpdate(undefined, true)).toBe(true);
  });

  it("keeps ordinary event updates optimistic", () => {
    expect(shouldDeferOptimisticEventUpdate(calendarEvent(), false)).toBe(
      false,
    );
  });
});

describe("reconcileUpdatedEventList", () => {
  it("rebinds a replaced working-location occurrence to its new id", () => {
    const original = calendarEvent({
      id: "google-instance-20260707",
      eventType: "workingLocation",
      accountEmail: "owner@example.com",
    });

    const reconciled = reconcileUpdatedEventList([original], original.id, {
      id: "google-working-location-override",
      replacedId: original.id,
      accountEmail: "owner@example.com",
    });

    expect(reconciled).toEqual([
      expect.objectContaining({
        id: "google-working-location-override",
        _replacedId: "google-instance-20260707",
        accountEmail: "owner@example.com",
      }),
    ]);
    expect(
      findEventByCurrentOrReplacedId(reconciled ?? [], original),
    ).toMatchObject({ id: "google-working-location-override" });
  });

  it("rebinds a selected event by account and calendar when provider IDs collide", () => {
    const selected = calendarEvent({
      id: "shared-provider-id",
      source: "google",
      accountEmail: "me@example.com",
      calendarSourceKey: "calendar-one",
      title: "Before update",
    });
    const otherAccount = calendarEvent({
      id: selected.id,
      source: "google",
      accountEmail: "other@example.com",
      calendarSourceKey: "calendar-two",
      title: "Other account",
    });
    const otherCalendar = calendarEvent({
      id: selected.id,
      source: "google",
      accountEmail: selected.accountEmail,
      calendarSourceKey: "calendar-two",
      title: "Other calendar",
    });
    const refreshed = calendarEvent({
      id: "replacement-provider-id",
      _replacedId: selected.id,
      source: selected.source,
      accountEmail: selected.accountEmail,
      calendarSourceKey: selected.calendarSourceKey,
      title: "After update",
    });

    expect(
      findEventByCurrentOrReplacedId(
        [otherAccount, otherCalendar, refreshed],
        selected,
      ),
    ).toBe(refreshed);
  });

  it("reconciles only the selected account when provider event IDs collide", () => {
    const otherAccount = calendarEvent({
      id: "shared-provider-id",
      source: "google",
      accountEmail: "other@example.com",
      title: "Other account",
    });
    const target = calendarEvent({
      id: otherAccount.id,
      source: "google",
      accountEmail: "me@example.com",
      title: "Before update",
    });

    expect(
      reconcileUpdatedEventList(
        [otherAccount, target],
        target.id,
        { id: target.id, title: "After update" },
        target.accountEmail,
      ),
    ).toEqual([otherAccount, { ...target, title: "After update" }]);
  });

  it("skips list-events cache entries holding the overlay-status inventory shape instead of an event array", () => {
    const queryClient = new QueryClient();
    const eventsKey = [
      "action",
      "list-events",
      { from: "2026-05-22T00:00:00.000Z", to: "2026-05-23T00:00:00.000Z" },
    ] as const;
    const overlayStatusKey = [
      "action",
      "list-events",
      {
        from: "2026-05-01T00:00:00.000Z",
        to: "2026-05-02T00:00:00.000Z",
        sources: ["overlays"],
        format: "inventory",
      },
    ] as const;
    const existingEvents = [calendarEvent()];
    const overlayStatus = {
      sourceCoverage: [
        { source: "overlay", id: "peer@example.com", status: "ok" },
      ],
    };
    queryClient.setQueryData(eventsKey, existingEvents);
    queryClient.setQueryData(overlayStatusKey, overlayStatus);

    const optimisticId = "optimistic_event_1";
    const created = calendarEvent({ id: "event-2" });

    expect(() =>
      updateListEventQueries(queryClient, (old, params) => {
        if (!calendarEventOverlapsListParams(created, params)) {
          return optimisticId
            ? removeOptimisticCalendarEventFromList(old, optimisticId)
            : old;
        }
        return mergeCalendarEventIntoList(old, created, optimisticId);
      }),
    ).not.toThrow();

    expect(queryClient.getQueryData(eventsKey)).toEqual(
      mergeCalendarEventIntoList(existingEvents, created, optimisticId),
    );
    expect(queryClient.getQueryData(overlayStatusKey)).toEqual(overlayStatus);
  });

  it("does not seed a not-yet-loaded overlay-status inventory query with an event array", () => {
    const queryClient = new QueryClient();
    const overlayStatusKey = [
      "action",
      "list-events",
      {
        from: "2026-05-22T00:00:00.000Z",
        to: "2026-05-23T00:00:00.000Z",
        sources: ["overlays"],
        format: "inventory",
      },
    ] as const;
    queryClient.getQueryCache().build(queryClient, {
      queryKey: overlayStatusKey,
    });
    expect(queryClient.getQueryData(overlayStatusKey)).toBeUndefined();

    const optimisticId = "optimistic_event_1";
    const created = calendarEvent({ id: "event-2" });

    updateListEventQueries(queryClient, (old, params) => {
      if (!calendarEventOverlapsListParams(created, params)) {
        return optimisticId
          ? removeOptimisticCalendarEventFromList(old, optimisticId)
          : old;
      }
      return mergeCalendarEventIntoList(old, created, optimisticId);
    });

    expect(queryClient.getQueryData(overlayStatusKey)).toBeUndefined();
  });
});
