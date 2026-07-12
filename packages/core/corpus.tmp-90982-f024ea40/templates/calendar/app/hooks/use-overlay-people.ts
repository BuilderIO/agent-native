import { callAction, useActionQuery } from "@agent-native/core/client";
import type { CalendarEvent, OverlayPerson } from "@shared/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getNextOverlayColor } from "@/lib/overlay-colors";

const OVERLAY_PEOPLE_KEY = ["action", "get-overlay-people", undefined] as const;

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
        queryClient.getQueryData(OVERLAY_PEOPLE_KEY) ?? [];
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
    // Removal is instant. Dropping a person changes the events query key
    // (overlayEmails), so the calendar shows the previous range's data as a
    // placeholder while it refetches — we strip this person's events out of
    // every cached range up front so they vanish immediately instead of
    // lingering until the refetch lands. The user's own events stay put.
    onMutate: async (email: string) => {
      await queryClient.cancelQueries({ queryKey: ["action", "list-events"] });
      const previousPeople =
        queryClient.getQueryData<OverlayPerson[]>(OVERLAY_PEOPLE_KEY);
      const previousEvents = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["action", "list-events"],
      });

      queryClient.setQueryData<OverlayPerson[]>(OVERLAY_PEOPLE_KEY, (old) =>
        old?.filter((p) => p.email !== email),
      );
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: ["action", "list-events"] },
        (old) => old?.filter((e) => e.overlayEmail !== email),
      );

      return { previousPeople, previousEvents };
    },
    onError: (_err, _email, context) => {
      const ctx = context as
        | {
            previousPeople?: OverlayPerson[];
            previousEvents?: Array<
              [readonly unknown[], CalendarEvent[] | undefined]
            >;
          }
        | undefined;
      if (ctx?.previousPeople) {
        queryClient.setQueryData(OVERLAY_PEOPLE_KEY, ctx.previousPeople);
      }
      if (ctx?.previousEvents) {
        for (const [key, data] of ctx.previousEvents) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(OVERLAY_PEOPLE_KEY, data);
    },
  });
}
