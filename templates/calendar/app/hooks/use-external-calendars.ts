import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActionQuery } from "@agent-native/core/client";
import type { ExternalCalendar } from "@shared/api";

export function useExternalCalendars() {
  return useActionQuery<ExternalCalendar[]>("list-external-calendars");
}

export function useAddExternalCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cal: { url: string; name?: string; color?: string }) => {
      const res = await fetch("/_agent-native/actions/add-external-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cal),
      });
      if (!res.ok) throw new Error("Failed to add calendar");
      return res.json() as Promise<ExternalCalendar>;
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
      const res = await fetch(
        "/_agent-native/actions/update-external-calendars",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated),
        },
      );
      if (!res.ok) throw new Error("Failed to save");
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
      const res = await fetch(
        "/_agent-native/actions/remove-external-calendar",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        },
      );
      if (!res.ok) throw new Error("Failed to remove calendar");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-external-calendars"],
      });
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}
