import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import type { CalendarEvent, UpdateEventScope } from "@shared/api";
import {
  useQueryClient,
  keepPreviousData,
  type QueryKey,
} from "@tanstack/react-query";
import { nanoid } from "nanoid";

import {
  applyCalendarEventRsvp,
  calendarEventOverlapsListParams,
  mergeCalendarEventIntoList,
  removeOptimisticCalendarEventFromList,
} from "./event-list-cache";

type CreateEventInput = Omit<
  CalendarEvent,
  "id" | "createdAt" | "updatedAt" | "source"
> & {
  _tempId?: string;
  addGoogleMeet?: boolean;
  addZoom?: boolean;
  workingLocationType?: "homeOffice" | "officeLocation" | "customLocation";
  workingLocationLabel?: string;
};

type UpdateEventInput = Partial<CalendarEvent> & {
  id: string;
  addGoogleMeet?: boolean;
  addZoom?: boolean;
  addAttendees?: CalendarEvent["attendees"];
  sendUpdates?: "all" | "none";
  notificationMessage?: string;
  scope?: UpdateEventScope;
};

type EventListSnapshot = Array<[QueryKey, CalendarEvent[] | undefined]>;
type EventListMutationContext = { previous?: EventListSnapshot };
type CreateEventMutationContext = EventListMutationContext & {
  optimisticId?: string;
};
type RsvpEventMutationContext = EventListMutationContext & {
  previousEvent?: CalendarEvent;
};

const LIST_EVENTS_QUERY_KEY = ["action", "list-events"] as const;
const OPTIMISTIC_EVENT_PREFIX = "optimistic_event_";

function buildEventsParams(
  from?: string,
  to?: string,
  overlayEmails?: string[],
): Record<string, string> {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (overlayEmails && overlayEmails.length > 0) {
    params.overlayEmails = overlayEmails.join(",");
  }
  return params;
}

function getListEventsParams(
  queryKey: QueryKey,
): Record<string, string> | undefined {
  const params = queryKey[2];
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  return params as Record<string, string>;
}

function getEventQueryKey(id: string) {
  return ["action", "get-event", { id }] as const;
}

function buildOptimisticCalendarEvent(
  newData: CreateEventInput,
  optimisticId: string,
): CalendarEvent {
  const now = new Date().toISOString();
  return {
    id: optimisticId,
    title: newData.title,
    start: newData.start,
    end: newData.end,
    startTimeZone: newData.startTimeZone,
    endTimeZone: newData.endTimeZone,
    allDay: newData.allDay ?? false,
    description: newData.description || "",
    location: newData.location || "",
    eventType: newData.eventType,
    color: newData.color,
    colorId: newData.colorId,
    attachments: newData.attachments,
    transparency: newData.transparency,
    visibility: newData.visibility,
    reminders: newData.reminders,
    remindersUseDefault: newData.remindersUseDefault,
    attendees: newData.attendees,
    accountEmail: newData.accountEmail,
    source: "local",
    createdAt: now,
    updatedAt: now,
  };
}

export function mergeAttendeeLists(
  existing: CalendarEvent["attendees"] | undefined,
  additions: CalendarEvent["attendees"] | undefined,
): CalendarEvent["attendees"] | undefined {
  if (!additions || additions.length === 0) return existing;
  const merged = new Map<
    string,
    NonNullable<CalendarEvent["attendees"]>[number]
  >();

  for (const attendee of existing ?? []) {
    const email = attendee.email?.trim();
    if (!email) continue;
    merged.set(email.toLowerCase(), { ...attendee, email });
  }

  for (const attendee of additions) {
    const email = attendee.email?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    const current = merged.get(key);
    merged.set(key, {
      ...current,
      email,
      displayName: attendee.displayName ?? current?.displayName,
      photoUrl: attendee.photoUrl ?? current?.photoUrl,
      optional:
        attendee.optional === true
          ? true
          : attendee.optional === false
            ? undefined
            : current?.optional,
    });
  }

  return Array.from(merged.values());
}

function updateListEventQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (
    old: CalendarEvent[] | undefined,
    params: Record<string, string> | undefined,
  ) => CalendarEvent[] | undefined,
) {
  const queries = queryClient.getQueriesData<CalendarEvent[]>({
    queryKey: LIST_EVENTS_QUERY_KEY,
  });

  for (const [queryKey] of queries) {
    const params = getListEventsParams(queryKey);
    queryClient.setQueryData<CalendarEvent[]>(queryKey, (old) =>
      updater(old, params),
    );
  }
}

/**
 * Decide whether to show the full-page events skeleton.
 *
 * The skeleton should appear only when there is nothing meaningful to show for
 * the *current date range* — the very first load, or navigating to a range we
 * have not fetched yet. When only the *set* of calendars or person overlays
 * changes (adding/removing a feed or person), the events query key changes and
 * `keepPreviousData` keeps the user's existing events on screen as placeholder
 * data; flashing a skeleton over them — wiping the calendar for several seconds
 * — is the bug we are avoiding. In that case we keep the events visible and let
 * the refreshed set merge in.
 *
 * `settledRangeKey` is the date range we last had real (non-placeholder) data
 * for; comparing it to the current `rangeKey` tells a genuine range change
 * apart from a same-range refetch triggered by a calendar toggle.
 */
export function shouldShowEventsSkeleton({
  isLoading,
  isPlaceholderData,
  settledRangeKey,
  rangeKey,
}: {
  isLoading: boolean;
  isPlaceholderData: boolean;
  settledRangeKey: string | null;
  rangeKey: string;
}): boolean {
  if (isLoading) return true;
  return isPlaceholderData && settledRangeKey !== rangeKey;
}

export function useEvents(
  from?: string,
  to?: string,
  overlayEmails?: string[],
) {
  const params = buildEventsParams(from, to, overlayEmails);

  return useActionQuery<CalendarEvent[]>("list-events", params, {
    retry: false,
    staleTime: 30_000,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Warm the events query cache for a given range without triggering a render.
 * Use to pre-fetch adjacent weeks so j/k navigation is instant — the same
 * stale/gc settings as `useEvents` apply, so the prefetched data is picked up
 * by the real query when the user actually navigates.
 */
export function prefetchEvents(
  queryClient: ReturnType<typeof useQueryClient>,
  from: string,
  to: string,
  overlayEmails?: string[],
) {
  const params = buildEventsParams(from, to, overlayEmails);
  return queryClient.prefetchQuery({
    queryKey: ["action", "list-events", params],
    queryFn: () =>
      callAction<CalendarEvent[]>("list-events", params, { method: "GET" }),
    staleTime: 30_000,
    gcTime: 30 * 60 * 1000,
  });
}

export function useEvent(id: string) {
  return useActionQuery<CalendarEvent>("get-event", { id }, { enabled: !!id });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useActionMutation<CalendarEvent, CreateEventInput>("create-event", {
    onMutate: async (newData) => {
      const optimisticId =
        newData._tempId ?? `${OPTIMISTIC_EVENT_PREFIX}${nanoid()}`;

      await queryClient.cancelQueries({ queryKey: LIST_EVENTS_QUERY_KEY });
      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: LIST_EVENTS_QUERY_KEY,
      });
      const optimisticEvent = buildOptimisticCalendarEvent(
        newData,
        optimisticId,
      );

      updateListEventQueries(queryClient, (old, params) => {
        if (!calendarEventOverlapsListParams(optimisticEvent, params)) {
          return old;
        }
        return mergeCalendarEventIntoList(old, optimisticEvent, optimisticId);
      });

      return { previous, optimisticId };
    },
    onSuccess: (created, _newData, context) => {
      const optimisticId = (context as CreateEventMutationContext | undefined)
        ?.optimisticId;
      updateListEventQueries(queryClient, (old, params) => {
        if (!calendarEventOverlapsListParams(created, params)) {
          return optimisticId
            ? removeOptimisticCalendarEventFromList(old, optimisticId)
            : old;
        }
        return mergeCalendarEventIntoList(old, created, optimisticId);
      });
    },
    onError: (_err, _newData, context) => {
      const previous = (context as CreateEventMutationContext | undefined)
        ?.previous;
      if (previous) {
        for (const [key, data] of previous) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: LIST_EVENTS_QUERY_KEY });
    },
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useActionMutation<
    Partial<CalendarEvent> & {
      id?: string;
      success?: boolean;
      updated?: string[];
      message?: string;
    },
    UpdateEventInput
  >("update-event", {
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: ["action", "list-events"] });
      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["action", "list-events"],
      });
      const {
        addGoogleMeet,
        addZoom,
        addAttendees,
        sendUpdates,
        notificationMessage,
        scope,
        ...optimisticData
      } = newData;
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: ["action", "list-events"] },
        (old) =>
          old?.map((e) =>
            e.id === optimisticData.id
              ? {
                  ...e,
                  ...optimisticData,
                  ...(addAttendees
                    ? {
                        attendees: mergeAttendeeLists(
                          e.attendees,
                          addAttendees,
                        ),
                      }
                    : {}),
                }
              : e,
          ),
      );
      return { previous };
    },
    onSuccess: (updated) => {
      const eventPatch = updated as
        | (Partial<CalendarEvent> & {
            id?: string;
            success?: boolean;
            updated?: string[];
            message?: string;
          })
        | undefined;
      if (!eventPatch?.id) return;
      const {
        success: _success,
        updated: _updated,
        message: _message,
        ...data
      } = eventPatch;
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: ["action", "list-events"] },
        (old) =>
          old?.map((event) =>
            event.id === eventPatch.id ? { ...event, ...data } : event,
          ),
      );
    },
    onError: (_err, _newData, context) => {
      const previous = (context as EventListMutationContext | undefined)
        ?.previous;
      if (previous) {
        for (const [key, data] of previous) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useActionMutation<
    {
      success: boolean;
      id: string;
      accountEmail: string;
      scope?: "single" | "all" | "thisAndFollowing";
      removedOnly: boolean;
    },
    {
      id: string;
      accountEmail?: string;
      scope?: "single" | "all" | "thisAndFollowing";
      sendUpdates?: "all" | "none";
      removeOnly?: boolean;
      notificationMessage?: string;
    }
  >("delete-event", {
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ["action", "list-events"] });
      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["action", "list-events"],
      });
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: ["action", "list-events"] },
        (old) => old?.filter((e) => e.id !== id),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      const previous = (context as EventListMutationContext | undefined)
        ?.previous;
      if (previous) {
        for (const [key, data] of previous) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}

export function useRsvpEvent() {
  const queryClient = useQueryClient();
  return useActionMutation<
    {
      success: boolean;
      id: string;
      accountEmail: string;
      status: "accepted" | "declined" | "tentative";
      note?: string;
      scope?: "single" | "all" | "thisAndFollowing";
    },
    {
      id: string;
      status: "accepted" | "declined" | "tentative";
      accountEmail?: string;
      scope?: "single" | "all" | "thisAndFollowing";
      note?: string;
      sendUpdates?: "all" | "none";
    }
  >("rsvp-event", {
    onMutate: async ({ id, status, accountEmail, scope, note }) => {
      await queryClient.cancelQueries({ queryKey: LIST_EVENTS_QUERY_KEY });
      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: LIST_EVENTS_QUERY_KEY,
      });
      const previousEvent = queryClient.getQueryData<CalendarEvent>(
        getEventQueryKey(id),
      );

      updateListEventQueries(queryClient, (old) =>
        applyCalendarEventRsvp(old, id, status, scope, accountEmail, note),
      );
      queryClient.setQueryData<CalendarEvent>(getEventQueryKey(id), (old) => {
        const updated = applyCalendarEventRsvp(
          old ? [old] : undefined,
          id,
          status,
          scope,
          accountEmail,
          note,
        );
        return updated?.[0];
      });

      return { previous, previousEvent };
    },
    onError: (_err, vars, context) => {
      const mutationContext = context as RsvpEventMutationContext | undefined;
      if (mutationContext?.previous) {
        for (const [key, data] of mutationContext.previous) {
          queryClient.setQueryData(key, data);
        }
      }
      if (mutationContext?.previousEvent) {
        queryClient.setQueryData(
          getEventQueryKey(vars.id),
          mutationContext.previousEvent,
        );
      }
    },
    onSettled: (_data, _error, vars) => {
      queryClient.invalidateQueries({ queryKey: LIST_EVENTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: getEventQueryKey(vars.id) });
    },
  });
}
