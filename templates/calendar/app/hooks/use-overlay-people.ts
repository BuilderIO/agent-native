import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActionQuery } from "@agent-native/core/client";
import type { OverlayPerson } from "@shared/api";
import { getNextOverlayColor } from "@/lib/overlay-colors";

export function useOverlayPeople() {
  return useActionQuery<OverlayPerson[]>("get-overlay-people");
}

export function useAddOverlayPerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (person: { email: string; name?: string }) => {
      const current: OverlayPerson[] =
        queryClient.getQueryData(["action", "get-overlay-people", undefined]) ??
        [];
      if (current.some((p) => p.email === person.email)) return current;
      const color = getNextOverlayColor(current);
      const updated = [...current, { ...person, color }];
      const res = await fetch("/_agent-native/actions/update-overlay-people", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error("Failed to save");
      return updated;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["action", "get-overlay-people", undefined],
        data,
      );
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}

export function useRemoveOverlayPerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const current: OverlayPerson[] =
        queryClient.getQueryData(["action", "get-overlay-people", undefined]) ??
        [];
      const updated = current.filter((p) => p.email !== email);
      const res = await fetch("/_agent-native/actions/update-overlay-people", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error("Failed to save");
      return updated;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["action", "get-overlay-people", undefined],
        data,
      );
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}
