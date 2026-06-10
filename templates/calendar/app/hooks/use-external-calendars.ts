import { useMutation, useQueryClient } from "@tanstack/react-query";
import { callAction, useActionQuery } from "@agent-native/core/client";
import type { CalendarEvent, ExternalCalendar } from "@shared/api";

const EXTERNAL_CALENDARS_KEY = [
  "action",
  "list-external-calendars",
  undefined,
] as const;

export function useExternalCalendars() {
  return useActionQuery<ExternalCalendar[]>("list-external-calendars");
}

export function useAddExternalCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cal: { url: string; name?: string; color?: string }) => {
      try {
        return await callAction<ExternalCalendar>("add-external-calendar", cal);
      } catch {
        throw new Error("Failed to add calendar");
      }
    },
    onSuccess: (created) => {
      // Surface the new calendar in the sidebar immediately, then let the
      // events query refetch in the background. The calendar view keeps the
      // user's existing events visible and shows a small spinner while the new
      // feed's events stream in — no skeleton over everything.
      if (created) {
        queryClient.setQueryData<ExternalCalendar[]>(
          EXTERNAL_CALENDARS_KEY,
          (old) => (old ? [...old, created] : [created]),
        );
      }
      queryClient.invalidateQueries({
        queryKey: ["action", "list-external-calendars"],
      });
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}

export function useUpdateExternalCalendarColor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, color }: { id: string; color: string }) => {
      const current: ExternalCalendar[] =
        queryClient.getQueryData([
          "action",
          "list-external-calendars",
          undefined,
        ]) ?? [];
      const updated = current.map((c) => (c.id === id ? { ...c, color } : c));
      try {
        await callAction<ExternalCalendar[]>(
          "update-external-calendars",
          { calendars: updated },
          { method: "PUT" },
        );
      } catch {
        throw new Error("Failed to save");
      }
      return updated;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["action", "list-external-calendars", undefined],
        data,
      );
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}

export function useRemoveExternalCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        await callAction("remove-external-calendar", { id });
      } catch {
        throw new Error("Failed to remove calendar");
      }
    },
    // Removal is instant: drop the calendar from the sidebar and strip just its
    // events out of every cached range. The user's own events stay exactly
    // where they are — no skeleton, and we deliberately do NOT invalidate
    // `list-events` (a full multi-source refetch is what made everything blink
    // out for several seconds). The cache is already correct; later navigation
    // refetches naturally.
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ["action", "list-events"] });
      const previousCalendars = queryClient.getQueryData<ExternalCalendar[]>(
        EXTERNAL_CALENDARS_KEY,
      );
      const previousEvents = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["action", "list-events"],
      });

      queryClient.setQueryData<ExternalCalendar[]>(
        EXTERNAL_CALENDARS_KEY,
        (old) => old?.filter((c) => c.id !== id),
      );
      const prefix = `ical-${id}-`;
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: ["action", "list-events"] },
        (old) => old?.filter((e) => !e.id.startsWith(prefix)),
      );

      return { previousCalendars, previousEvents };
    },
    onError: (_err, _id, context) => {
      const ctx = context as
        | {
            previousCalendars?: ExternalCalendar[];
            previousEvents?: Array<
              [readonly unknown[], CalendarEvent[] | undefined]
            >;
          }
        | undefined;
      if (ctx?.previousCalendars) {
        queryClient.setQueryData(EXTERNAL_CALENDARS_KEY, ctx.previousCalendars);
      }
      if (ctx?.previousEvents) {
        for (const [key, data] of ctx.previousEvents) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-external-calendars"],
      });
    },
  });
}
