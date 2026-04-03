import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
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

  return useQuery<CalendarEvent[]>({
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
    placeholderData: keepPreviousData,
  });
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
      data: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt" | "source">,
    ) => {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create event");
      return res.json();
    },
    onSuccess: () => {
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
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete event");
      return res.json();
    },
    onSuccess: () => {
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
