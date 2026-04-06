import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CalendarEvent } from "@shared/api";

export function useEvents(
  from?: string,
  to?: string,
  overlayEmails?: string[],
) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (overlayEmails && overlayEmails.length > 0) {
    params.set("overlayEmails", overlayEmails.join(","));
  }
  const qs = params.toString();

  const query = useQuery<CalendarEvent[]>({
    queryKey: ["events", from, to, overlayEmails?.join(",") ?? ""],
    queryFn: async () => {
      const res = await fetch(`/api/events${qs ? `?${qs}` : ""}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch events");
      }
      return res.json();
    },
    retry: false,
    staleTime: 30_000,
    gcTime: 30 * 60 * 1000,
  });
  return query;
}

export function useEvent(id: string) {
  return useQuery<CalendarEvent>({
    queryKey: ["events", id],
    queryFn: async () => {
      const res = await fetch(`/api/events/${id}`);
      if (!res.ok) throw new Error("Failed to fetch event");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      data: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt" | "source"> & {
        /** Temporary client-side ID used for optimistic rendering */
        _tempId?: string;
      },
    ) => {
      const { _tempId, ...eventData } = data;
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      });
      if (!res.ok) throw new Error("Failed to create event");
      const result = await res.json();
      // Return tempId so onSuccess can map it
      return { ...result, _tempId };
    },
    onMutate: async (newData) => {
      if (!newData._tempId) return;
      await queryClient.cancelQueries({ queryKey: ["events"] });
      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["events"],
      });
      // Optimistically add the event to all matching queries
      const optimisticEvent: CalendarEvent = {
        id: newData._tempId,
        title: newData.title,
        start: newData.start,
        end: newData.end,
        allDay: newData.allDay ?? false,
        description: newData.description,
        location: newData.location,
        source: "local",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: ["events"] },
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
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: Partial<CalendarEvent> & { id: string }) => {
      const res = await fetch(`/api/events/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update event");
      return res.json();
    },
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: ["events"] });
      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["events"],
      });
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: ["events"] },
        (old) =>
          old?.map((e) => (e.id === newData.id ? { ...e, ...newData } : e)),
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
      queryClient.invalidateQueries({ queryKey: ["events"] });
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
    }: {
      id: string;
      scope?: "single" | "all" | "thisAndFollowing";
      sendUpdates?: "all" | "none";
      removeOnly?: boolean;
    }) => {
      const res = await fetch(`/api/events/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, sendUpdates, removeOnly }),
      });
      if (!res.ok) throw new Error("Failed to delete event");
      return res.json();
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ["events"] });
      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["events"],
      });
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: ["events"] },
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
      queryClient.invalidateQueries({ queryKey: ["events"] });
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
      const res = await fetch(`/api/events/${id}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, accountEmail, scope }),
      });
      if (!res.ok) throw new Error("Failed to update RSVP");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}
