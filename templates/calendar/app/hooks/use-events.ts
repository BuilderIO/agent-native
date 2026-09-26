import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type { CalendarEvent, UpdateEventScope } from "@shared/api";
import { addDaysToDateKey } from "@shared/timezone";
import {
  useQueryClient,
  useQuery,
  useQueries,
  keepPreviousData,
  type QueryKey,
} from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useMemo } from "react";

import type { CalendarEventSourceIdentity } from "@/lib/calendar-event-identity";
import { isEventVisibleForDeclinedPreference } from "@/lib/calendar-view-preferences";
import { dateTimeInTimezoneToIso } from "@/lib/event-form-utils";
import {
  isSharedCalendarDemo,
  SHARED_CALENDAR_DEMO_EVENTS,
} from "@/lib/shared-calendar-demo";
import {
  buildWorkingLocationProperties,
  getWorkingLocationEditableLabel,
  getWorkingLocationType,
} from "@/lib/working-location";

import {
  applyCalendarEventRsvp,
  calendarEventIsInScope,
  calendarEventOverlapsListParams,
  findCalendarEventById,
  findCalendarEventForSelection,
  getRemovedCalendarEvents,
  mergeCalendarEventIntoList,
  removeCalendarEventsForScope,
  removeOptimisticCalendarEventFromList,
  restoreMissingCalendarEvents,
} from "./event-list-cache";

type CreateEventInput = Omit<
  CalendarEvent,
  "id" | "createdAt" | "updatedAt" | "source" | "title"
> & {
  title?: string;
  _tempId?: string;
  fullDay?: boolean;
  autoDeclineMode?:
    | "declineNone"
    | "declineAllConflictingInvitations"
    | "declineOnlyNewConflictingInvitations";
  declineMessage?: string;
  addGoogleMeet?: boolean;
  addZoom?: boolean;
  workingLocationType?: "homeOffice" | "officeLocation" | "customLocation";
  workingLocationLabel?: string;
};

type UpdateEventInput = Partial<CalendarEvent> & {
  id: string;
  cacheEventIdentity?: CalendarEventSourceIdentity;
  targetAccountEmail?: string;
  addGoogleMeet?: boolean;
  removeGoogleMeet?: boolean;
  addZoom?: boolean;
  addAttendees?: CalendarEvent["attendees"];
  sendUpdates?: "all" | "none";
  notificationMessage?: string;
  scope?: UpdateEventScope;
  workingLocationType?: "homeOffice" | "officeLocation" | "customLocation";
  workingLocationLabel?: string;
};

type EventListSnapshot = Array<[QueryKey, CalendarEvent[] | undefined]>;
type EventListMutationContext = { previous?: EventListSnapshot };
type CreateEventMutationContext = EventListMutationContext & {
  optimisticId?: string;
};
type RsvpEventMutationContext = EventListMutationContext & {
  previousEventQueries?: Array<[QueryKey, CalendarEvent | undefined]>;
};
type DeleteEventMutationContext = {
  removedByQuery?: Array<[QueryKey, CalendarEvent[]]>;
};

type UpdateEventResult = Partial<CalendarEvent> & {
  id?: string;
  replacedId?: string;
  success?: boolean;
  updated?: string[];
  message?: string;
  removedGoogleMeet?: boolean;
};

const LIST_EVENTS_QUERY_KEY = ["action", "list-events"] as const;
export const OVERLAY_EVENTS_BATCH_KEY = ["overlay-events-batch"] as const;
const OPTIMISTIC_EVENT_PREFIX = "optimistic_event_";

function invalidateEventQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: LIST_EVENTS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: OVERLAY_EVENTS_BATCH_KEY });
}

function buildEventsParams(
  from?: string,
  to?: string,
  overlayEmails?: string[],
  calendarSourceKeys?: string[],
): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (overlayEmails && overlayEmails.length > 0) {
    params.overlayEmails = overlayEmails.join(",");
  }
  if (calendarSourceKeys && calendarSourceKeys.length > 0) {
    params.calendarSourceKeys = calendarSourceKeys;
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

export function getOptimisticTitleIsGenerated(
  input: Pick<CreateEventInput, "title" | "titleIsGenerated">,
): boolean {
  return input.titleIsGenerated ?? !input.title?.trim();
}

function buildOptimisticCalendarEvent(
  newData: CreateEventInput,
  optimisticId: string,
): CalendarEvent {
  const now = new Date().toISOString();
  const timezone = newData.startTimeZone ?? newData.endTimeZone;
  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
  const nextDate = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return next.toISOString().slice(0, 10);
  };
  const fullDayOutOfOffice =
    newData.eventType === "outOfOffice" && newData.fullDay && timezone;
  const start =
    fullDayOutOfOffice && dateOnlyPattern.test(newData.start)
      ? dateTimeInTimezoneToIso(newData.start, "00:00", timezone!)
      : newData.start;
  const end =
    fullDayOutOfOffice && dateOnlyPattern.test(newData.end)
      ? dateTimeInTimezoneToIso(nextDate(newData.end), "00:00", timezone!)
      : newData.end;
  return {
    id: optimisticId,
    title:
      newData.title?.trim() ||
      (newData.eventType === "outOfOffice" ? "Out of office" : ""),
    titleIsGenerated: getOptimisticTitleIsGenerated(newData),
    start,
    end,
    startTimeZone: newData.startTimeZone,
    endTimeZone: newData.endTimeZone,
    allDay: fullDayOutOfOffice ? false : (newData.allDay ?? false),
    description: newData.description || "",
    location: newData.location || "",
    eventType: newData.eventType,
    color: newData.color,
    colorId: newData.colorId,
    attachments: newData.attachments,
    transparency: newData.transparency,
    visibility: newData.visibility,
    outOfOfficeProperties:
      newData.eventType === "outOfOffice"
        ? {
            autoDeclineMode:
              newData.autoDeclineMode ?? "declineAllConflictingInvitations",
            declineMessage:
              newData.autoDeclineMode === "declineNone"
                ? undefined
                : (newData.declineMessage ??
                  "Declined because I am out of office"),
          }
        : undefined,
    reminders: newData.reminders,
    remindersUseDefault: newData.remindersUseDefault,
    recurrence: newData.recurrence,
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

export function shouldDeferOptimisticEventUpdate(
  target: CalendarEvent | undefined,
  hasWorkingLocationUpdate: boolean,
): boolean {
  return (
    hasWorkingLocationUpdate ||
    (target?.eventType === "workingLocation" && target.allDay === true)
  );
}

export function updateListEventQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (
    old: CalendarEvent[] | undefined,
    params: Record<string, string> | undefined,
  ) => CalendarEvent[] | undefined,
) {
  const queries = queryClient.getQueriesData<CalendarEvent[]>({
    queryKey: LIST_EVENTS_QUERY_KEY,
  });

  for (const [queryKey, data] of queries) {
    const params = getListEventsParams(queryKey);
    if (params?.format === "inventory") continue;
    if (data !== undefined && !Array.isArray(data)) continue;
    queryClient.setQueryData<CalendarEvent[]>(queryKey, (old) =>
      updater(old, params),
    );
  }
}

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

export const EVENTS_OVERLAY_BATCH_SIZE = 10;

export function useEvents(
  from?: string,
  to?: string,
  overlayEmails?: string[],
  calendarSourceKeys?: string[],
) {
  const primaryOverlayEmails = overlayEmails?.slice(
    0,
    EVENTS_OVERLAY_BATCH_SIZE,
  );
  const extraOverlayBatches = useMemo(() => {
    if (!overlayEmails || overlayEmails.length <= EVENTS_OVERLAY_BATCH_SIZE) {
      return [];
    }
    const batches: string[][] = [];
    for (
      let i = EVENTS_OVERLAY_BATCH_SIZE;
      i < overlayEmails.length;
      i += EVENTS_OVERLAY_BATCH_SIZE
    ) {
      batches.push(overlayEmails.slice(i, i + EVENTS_OVERLAY_BATCH_SIZE));
    }
    return batches;
  }, [overlayEmails]);

  const params = buildEventsParams(
    from,
    to,
    primaryOverlayEmails,
    calendarSourceKeys,
  );
  const demo = isSharedCalendarDemo();
  const live = useActionQuery<CalendarEvent[]>("list-events", params, {
    enabled: !demo,
    retry: false,
    staleTime: 30_000,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
  const extraOverlayQueries = useQueries({
    queries: extraOverlayBatches.map((batch) => {
      const batchParams = {
        ...buildEventsParams(from, to, batch),
        sources: ["overlays"],
      };
      return {
        queryKey: ["overlay-events-batch", batchParams] as QueryKey,
        queryFn: () =>
          callAction<CalendarEvent[]>("list-events", batchParams, {
            method: "GET",
          }),
        enabled: !demo,
        retry: false,
        staleTime: 30_000,
        gcTime: 30 * 60 * 1000,
        placeholderData: keepPreviousData,
      };
    }),
  });
  const fixture = useQuery({
    queryKey: ["shared-calendar-demo-events", params],
    queryFn: async () => {
      const selected = new Set(calendarSourceKeys ?? []);
      return SHARED_CALENDAR_DEMO_EVENTS.filter((event) => {
        if (!event.calendarSourceKey) return true;
        return selected.size === 0 || selected.has(event.calendarSourceKey);
      });
    },
    enabled: demo,
    staleTime: Infinity,
  });

  const mergedData = useMemo(() => {
    if (!Array.isArray(live.data) || extraOverlayQueries.length === 0) {
      return live.data;
    }
    const extras = extraOverlayQueries.flatMap((query) =>
      Array.isArray(query.data) ? query.data : [],
    );
    return extras.length > 0 ? [...live.data, ...extras] : live.data;
  }, [live.data, extraOverlayQueries]);

  if (demo) return fixture;
  if (extraOverlayQueries.length === 0) return live;

  const overlayError = extraOverlayQueries.find((q) => q.error)?.error;

  return {
    ...live,
    data: mergedData,
    isLoading: live.isLoading,
    isFetching:
      live.isFetching || extraOverlayQueries.some((q) => q.isFetching),
    isPlaceholderData:
      live.isPlaceholderData ||
      extraOverlayQueries.some((q) => q.isPlaceholderData),
    error: live.error ?? overlayError ?? null,
    isError: live.isError || Boolean(overlayError),
  };
}

type OverlaySourceCoverage = {
  source: "overlay";
  id: string;
  status: "ok" | "error";
  error?: { code: string; message: string; retryable: boolean };
};

type OverlayStatusResult = {
  sourceCoverage: Array<
    OverlaySourceCoverage | { source: string; id: string; status: string }
  >;
};

const OVERLAY_STATUS_BATCH_SIZE = 10;

export function useOverlayCalendarStatus(overlayEmails: string[]) {
  const today = new Date().toISOString().slice(0, 10);
  const to = addDaysToDateKey(today, 1);
  const batches = useMemo(() => {
    const chunks: string[][] = [];
    for (let i = 0; i < overlayEmails.length; i += OVERLAY_STATUS_BATCH_SIZE) {
      chunks.push(overlayEmails.slice(i, i + OVERLAY_STATUS_BATCH_SIZE));
    }
    return chunks;
  }, [overlayEmails]);
  const queries = useQueries({
    queries: batches.map((batch) => {
      const params = {
        from: today,
        to,
        sources: ["overlays"],
        overlayEmails: batch,
        format: "inventory",
      };
      return {
        queryKey: ["action", "list-events", params] as QueryKey,
        queryFn: () =>
          callAction<OverlayStatusResult>("list-events", params, {
            method: "GET",
          }),
        retry: false,
        staleTime: 5 * 60_000,
      };
    }),
  });
  const statusByEmail = useMemo(() => {
    const map = new Map<string, OverlaySourceCoverage>();
    for (const query of queries) {
      const coverage = query.data?.sourceCoverage ?? [];
      for (const entry of coverage) {
        if (entry.source === "overlay") {
          map.set(entry.id.toLowerCase(), entry as OverlaySourceCoverage);
        }
      }
    }
    return map;
  }, [queries]);
  return statusByEmail;
}

export function prefetchEvents(
  queryClient: ReturnType<typeof useQueryClient>,
  from: string,
  to: string,
  overlayEmails?: string[],
  calendarSourceKeys?: string[],
) {
  if (isSharedCalendarDemo()) return;
  const primaryOverlayEmails = overlayEmails
    ? overlayEmails.slice(0, EVENTS_OVERLAY_BATCH_SIZE)
    : overlayEmails;
  const params = buildEventsParams(
    from,
    to,
    primaryOverlayEmails,
    calendarSourceKeys,
  );
  return queryClient.prefetchQuery({
    queryKey: ["action", "list-events", params],
    queryFn: () =>
      callAction<CalendarEvent[]>("list-events", params, { method: "GET" }),
    staleTime: 30_000,
    gcTime: 30 * 60 * 1000,
  });
}

export function useEvent(id: string, calendarSourceKey?: string) {
  return useActionQuery<CalendarEvent>(
    "get-event",
    calendarSourceKey ? { id, calendarSourceKey } : { id },
    { enabled: !!id },
  );
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
      invalidateEventQueries(queryClient);
    },
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useActionMutation<UpdateEventResult, UpdateEventInput>(
    "update-event",
    {
      onMutate: async (newData) => {
        await queryClient.cancelQueries({
          queryKey: ["action", "list-events"],
        });
        const previous = queryClient.getQueriesData<CalendarEvent[]>({
          queryKey: ["action", "list-events"],
        });
        const { cacheEventIdentity, ...eventInput } = newData;
        const {
          addGoogleMeet,
          removeGoogleMeet,
          addZoom,
          addAttendees,
          targetAccountEmail,
          sendUpdates,
          notificationMessage,
          scope,
          workingLocationType,
          workingLocationLabel,
          ...optimisticData
        } = eventInput;
        const optimisticPatch = targetAccountEmail
          ? {}
          : {
              ...optimisticData,
              ...(removeGoogleMeet
                ? { hangoutLink: undefined, conferenceData: undefined }
                : {}),
            };
        const hasWorkingLocationUpdate =
          workingLocationType !== undefined ||
          workingLocationLabel !== undefined;
        queryClient.setQueriesData<CalendarEvent[]>(
          { queryKey: ["action", "list-events"] },
          (old) => {
            const target = old
              ? findCalendarEventById(
                  old,
                  optimisticData.id,
                  cacheEventIdentity ?? optimisticData.accountEmail,
                )
              : undefined;
            if (!target) return old;
            if (
              shouldDeferOptimisticEventUpdate(target, hasWorkingLocationUpdate)
            )
              return old;
            return old?.map((e) => {
              const matchesScope = calendarEventIsInScope(
                e,
                target,
                scope ?? "single",
              );
              if (!matchesScope) return e;
              const nextWorkingLocationType =
                workingLocationType ?? getWorkingLocationType(e);
              const nextWorkingLocationLabel =
                workingLocationLabel ?? getWorkingLocationEditableLabel(e);
              return {
                ...e,
                ...optimisticPatch,
                ...(hasWorkingLocationUpdate
                  ? {
                      workingLocationProperties: buildWorkingLocationProperties(
                        e,
                        {
                          type: nextWorkingLocationType,
                          label: nextWorkingLocationLabel,
                        },
                      ),
                    }
                  : {}),
                ...(addAttendees
                  ? {
                      attendees: mergeAttendeeLists(e.attendees, addAttendees),
                    }
                  : {}),
              };
            });
          },
        );
        return { previous };
      },
      onSuccess: (updated, input) => {
        const eventPatch = updated as UpdateEventResult | undefined;
        if (!eventPatch?.id) return;
        queryClient.setQueriesData<CalendarEvent[]>(
          { queryKey: ["action", "list-events"] },
          (old) =>
            reconcileUpdatedEventList(
              old,
              input.id,
              eventPatch,
              input.accountEmail,
              input.cacheEventIdentity,
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
        invalidateEventQueries(queryClient);
      },
    },
  );
}

export function reconcileUpdatedEventList(
  events: CalendarEvent[] | undefined,
  originalId: string,
  result: UpdateEventResult,
  accountEmail?: string,
  cacheEventIdentity?: CalendarEventSourceIdentity,
): CalendarEvent[] | undefined {
  if (!result.id) return events;
  const {
    success: _success,
    updated: _updated,
    message: _message,
    removedGoogleMeet: _removedGoogleMeet,
    replacedId,
    ...eventPatch
  } = result;
  const targetId = replacedId ?? originalId;
  const target = events
    ? findCalendarEventById(
        events,
        targetId,
        cacheEventIdentity ?? accountEmail,
      )
    : undefined;
  if (!target) return events;

  return events?.map((event) => {
    if (!calendarEventIsInScope(event, target, "single")) return event;
    const idChanged = event.id !== eventPatch.id;
    return {
      ...event,
      ...eventPatch,
      ...(idChanged ? { _replacedId: event.id } : {}),
    };
  });
}

export function findEventByCurrentOrReplacedId(
  events: CalendarEvent[],
  selectedEvent: CalendarEvent,
): CalendarEvent | undefined {
  return findCalendarEventForSelection(events, selectedEvent);
}

export function findVisibleSelectedEvent(
  events: CalendarEvent[],
  selectedEvent: CalendarEvent,
  showDeclinedEvents: boolean,
): CalendarEvent | undefined {
  const currentEvent =
    findEventByCurrentOrReplacedId(events, selectedEvent) ?? selectedEvent;
  return isEventVisibleForDeclinedPreference(
    currentEvent.responseStatus,
    showDeclinedEvents,
  )
    ? currentEvent
    : undefined;
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
      cacheEventIdentity?: CalendarEventSourceIdentity;
      scope?: "single" | "all" | "thisAndFollowing";
      sendUpdates?: "all" | "none";
      removeOnly?: boolean;
      notificationMessage?: string;
    }
  >("delete-event", {
    onMutate: async ({ id, accountEmail, cacheEventIdentity, scope }) => {
      await queryClient.cancelQueries({ queryKey: ["action", "list-events"] });
      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["action", "list-events"],
      });
      const cachedEvents = previous.flatMap(([, events]) => events ?? []);
      const targetEvent = findCalendarEventById(
        cachedEvents,
        id,
        cacheEventIdentity ?? accountEmail,
      );
      const hasMatchingEvents = cachedEvents.some(
        (event) => event.id === id || event._replacedId === id,
      );
      if (hasMatchingEvents && !targetEvent) return { removedByQuery: [] };
      const removedByQuery: Array<[QueryKey, CalendarEvent[]]> = [];
      for (const [key, old] of previous) {
        const next = removeCalendarEventsForScope(
          old,
          id,
          scope,
          targetEvent,
          accountEmail,
        );
        const removed = getRemovedCalendarEvents(old, next);
        if (removed.length > 0) removedByQuery.push([key, removed]);
        if (next !== old) queryClient.setQueryData(key, next);
      }
      return { removedByQuery };
    },
    onError: (_err, _vars, context) => {
      const removedByQuery = (context as DeleteEventMutationContext | undefined)
        ?.removedByQuery;
      for (const [key, removed] of removedByQuery ?? []) {
        queryClient.setQueryData<CalendarEvent[]>(key, (current) =>
          restoreMissingCalendarEvents(current, removed),
        );
      }
    },
    onSettled: () => {
      invalidateEventQueries(queryClient);
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
      cacheEventIdentity?: CalendarEventSourceIdentity;
      scope?: "single" | "all" | "thisAndFollowing";
      note?: string;
      sendUpdates?: "all" | "none";
    }
  >("rsvp-event", {
    onMutate: async ({
      id,
      status,
      accountEmail,
      cacheEventIdentity,
      scope,
      note,
    }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: LIST_EVENTS_QUERY_KEY }),
        queryClient.cancelQueries({ queryKey: ["action", "get-event"] }),
      ]);
      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: LIST_EVENTS_QUERY_KEY,
      });
      const previousEventQueries = queryClient
        .getQueriesData<CalendarEvent>({ queryKey: ["action", "get-event"] })
        .filter(([, event]) => {
          if (!event) return false;
          const next = applyCalendarEventRsvp(
            [event],
            id,
            status,
            scope,
            accountEmail,
            note,
            cacheEventIdentity,
          );
          return next?.[0] !== event;
        });

      updateListEventQueries(queryClient, (old) =>
        applyCalendarEventRsvp(
          old,
          id,
          status,
          scope,
          accountEmail,
          note,
          cacheEventIdentity,
        ),
      );
      for (const [key, event] of previousEventQueries) {
        const updated = applyCalendarEventRsvp(
          event ? [event] : undefined,
          id,
          status,
          scope,
          accountEmail,
          note,
          cacheEventIdentity,
        );
        queryClient.setQueryData(key, updated?.[0]);
      }

      return { previous, previousEventQueries };
    },
    onError: (_err, _vars, context) => {
      const mutationContext = context as RsvpEventMutationContext | undefined;
      if (mutationContext?.previous) {
        for (const [key, data] of mutationContext.previous) {
          queryClient.setQueryData(key, data);
        }
      }
      for (const [key, event] of mutationContext?.previousEventQueries ?? []) {
        queryClient.setQueryData(key, event);
      }
    },
    onSettled: () => {
      invalidateEventQueries(queryClient);
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-event"],
      });
    },
  });
}
