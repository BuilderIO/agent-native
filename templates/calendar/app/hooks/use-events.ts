import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { agentNativePath, useActionQuery } from "@agent-native/core/client";
import { appApiPath } from "@/lib/api-path";
import type { CalendarEvent } from "@shared/api";

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
  sendUpdates?: "all" | "none";
  notificationMessage?: string;
};

async function readErrorMessage(res: Response, fallback: string) {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body.error || body.message || fallback;
  } catch {
    return fallback;
  }
}

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
    queryFn: async () => {
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(
        agentNativePath(`/_agent-native/actions/list-events?${qs}`),
      );
      if (!res.ok) throw new Error("prefetch list-events failed");
      return res.json();
    },
    staleTime: 30_000,
    gcTime: 30 * 60 * 1000,
  });
}

export function useEvent(id: string) {
  return useQuery<CalendarEvent>({
    queryKey: ["events", id],
    queryFn: async () => {
      const res = await fetch(appApiPath(`/api/events/${id}`));
      if (!res.ok) throw new Error("Failed to fetch event");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateEventInput) => {
      const { _tempId, ...eventData } = data;
      const res = await fetch(
        agentNativePath("/_agent-native/actions/create-event"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(eventData),
        },
      );
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to create event"));
      }
      const result = await res.json();
      return { ...result, _tempId };
    },
    onMutate: async (newData) => {
      if (!newData._tempId) return;
      await queryClient.cancelQueries({ queryKey: ["action", "list-events"] });
      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["action", "list-events"],
      });
      const optimisticEvent: CalendarEvent = {
        id: newData._tempId,
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
        source: "local",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: ["action", "list-events"] },
        (old) => (old ? [...old, optimisticEvent] : [optimisticEvent]),
      );
      return { previous };
    },
    onError: (_err, _newData, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateEventInput) => {
      const res = await fetch(appApiPath(`/api/events/${id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to update event"));
      }
      return res.json();
    },
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: ["action", "list-events"] });
      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["action", "list-events"],
      });
      const {
        addGoogleMeet,
        addZoom,
        sendUpdates,
        notificationMessage,
        ...optimisticData
      } = newData;
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: ["action", "list-events"] },
        (old) =>
          old?.map((e) =>
            e.id === optimisticData.id ? { ...e, ...optimisticData } : e,
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
      if (context?.previous) {
        for (const [key, data] of context.previous) {
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
  return useMutation({
    mutationFn: async ({
      id,
      scope,
      sendUpdates,
      removeOnly,
      notificationMessage,
    }: {
      id: string;
      scope?: "single" | "all" | "thisAndFollowing";
      sendUpdates?: "all" | "none";
      removeOnly?: boolean;
      notificationMessage?: string;
    }) => {
      const res = await fetch(appApiPath(`/api/events/${id}`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          sendUpdates,
          removeOnly,
          notificationMessage,
        }),
      });
      if (!res.ok) throw new Error("Failed to delete event");
      return res.json();
    },
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
      if (context?.previous) {
        for (const [key, data] of context.previous) {
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
  return useMutation({
    mutationFn: async ({
      id,
      status,
      accountEmail,
      scope,
    }: {
      id: string;
      status: "accepted" | "declined" | "tentative";
      accountEmail?: string;
      scope?: "single" | "all" | "thisAndFollowing";
    }) => {
      const res = await fetch(appApiPath(`/api/events/${id}/rsvp`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, accountEmail, scope }),
      });
      if (!res.ok) throw new Error("Failed to update RSVP");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}
