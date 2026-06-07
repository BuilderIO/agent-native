import { useMutation, useQueryClient } from "@tanstack/react-query";
import { callAction, useActionQuery } from "@agent-native/core/client";
import type { ExternalCalendar } from "@shared/api";

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
    onSuccess: () => {
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
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-external-calendars"],
      });
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}
