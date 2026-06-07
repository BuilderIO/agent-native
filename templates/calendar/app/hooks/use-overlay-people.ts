import { useMutation, useQueryClient } from "@tanstack/react-query";
import { callAction, useActionQuery } from "@agent-native/core/client";
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
      try {
        await callAction<OverlayPerson[]>(
          "update-overlay-people",
          { people: updated },
          { method: "PUT" },
        );
      } catch {
        throw new Error("Failed to save");
      }
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

export function useUpdateOverlayPersonColor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, color }: { email: string; color: string }) => {
      const current: OverlayPerson[] =
        queryClient.getQueryData(["action", "get-overlay-people", undefined]) ??
        [];
      const updated = current.map((p) =>
        p.email === email ? { ...p, color } : p,
      );
      try {
        await callAction<OverlayPerson[]>(
          "update-overlay-people",
          { people: updated },
          { method: "PUT" },
        );
      } catch {
        throw new Error("Failed to save");
      }
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
      try {
        await callAction<OverlayPerson[]>(
          "update-overlay-people",
          { people: updated },
          { method: "PUT" },
        );
      } catch {
        throw new Error("Failed to save");
      }
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
