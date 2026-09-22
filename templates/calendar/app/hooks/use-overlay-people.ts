import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import type { CalendarEvent, OverlayPerson } from "@shared/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { OVERLAY_EVENTS_BATCH_KEY } from "@/hooks/use-events";

const OVERLAY_PEOPLE_KEY = ["action", "get-overlay-people", undefined] as const;

export function useOverlayPeople() {
  return useActionQuery<OverlayPerson[]>("get-overlay-people");
}

function invalidateOverlayStatusQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  // Adding/removing/recoloring a peer can flip whether a booking-link host
  // counts as calendar-managed (e.g. the owner adding back a host who was
  // showing as manual) and can also make an existing peer reciprocal, so both
  // owner-scoped status reads must refetch rather than keep serving a
  // pre-change snapshot until an unrelated refetch happens to land.
  void queryClient.invalidateQueries({
    queryKey: ["action", "get-host-overlay-status"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["action", "get-overlay-reciprocity"],
  });
}

export function useAddOverlayPerson() {
  const queryClient = useQueryClient();
  return useMutation({
    // Applied atomically on the server (add-overlay-person reads and writes
    // `calendar-overlay-people` inside one mutateUserSetting compare-and-swap)
    // rather than the client fetching the current list and PUTting a full
    // replacement — two adds started concurrently from separate UI surfaces
    // or tabs would otherwise both read the same stale list and let whichever
    // full-list write lands last silently drop the other's addition.
    mutationFn: (person: { email: string; name?: string }) =>
      callAction<OverlayPerson[]>("add-overlay-person", person, {
        method: "PUT",
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(OVERLAY_PEOPLE_KEY, data);
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-events"],
      });
      invalidateOverlayStatusQueries(queryClient);
    },
  });
}

export function useUpdateOverlayPersonColor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, color }: { email: string; color: string }) =>
      callAction<OverlayPerson[]>(
        "update-overlay-person-color",
        { email, color },
        { method: "PUT" },
      ),
    onMutate: async ({ email, color }) => {
      await queryClient.cancelQueries({ queryKey: OVERLAY_PEOPLE_KEY });
      const previousPeople =
        queryClient.getQueryData<OverlayPerson[]>(OVERLAY_PEOPLE_KEY);
      queryClient.setQueryData<OverlayPerson[]>(OVERLAY_PEOPLE_KEY, (old) =>
        old?.map((person) =>
          person.email === email ? { ...person, color } : person,
        ),
      );
      return { previousPeople };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousPeople) {
        queryClient.setQueryData(OVERLAY_PEOPLE_KEY, context.previousPeople);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(OVERLAY_PEOPLE_KEY, data);
    },
  });
}

export function useRemoveOverlayPerson() {
  const queryClient = useQueryClient();
  return useMutation({
    // Same atomicity reasoning as useAddOverlayPerson: applied on the server
    // inside remove-overlay-person's own mutateUserSetting read, not against
    // a client-fetched snapshot.
    mutationFn: (email: string) =>
      callAction<OverlayPerson[]>(
        "remove-overlay-person",
        { email },
        { method: "PUT" },
      ),
    // Removal is instant. Dropping a person changes the events query key
    // (overlayEmails), so the calendar shows the previous range's data as a
    // placeholder while it refetches — we strip this person's events out of
    // every cached range up front so they vanish immediately instead of
    // lingering until the refetch lands. The user's own events stay put.
    // Peers past the first 10 live under OVERLAY_EVENTS_BATCH_KEY instead of
    // the primary list-events key (see useEvents); a reshuffled batch there
    // uses keepPreviousData, so without this patch a removed overflow peer's
    // events would keep showing as placeholder data until that batch refetches.
    onMutate: async (email: string) => {
      await queryClient.cancelQueries({ queryKey: ["action", "list-events"] });
      await queryClient.cancelQueries({ queryKey: OVERLAY_EVENTS_BATCH_KEY });
      const previousPeople =
        queryClient.getQueryData<OverlayPerson[]>(OVERLAY_PEOPLE_KEY);
      const previousEvents = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["action", "list-events"],
      });
      const previousBatchEvents = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: OVERLAY_EVENTS_BATCH_KEY,
      });

      queryClient.setQueryData<OverlayPerson[]>(OVERLAY_PEOPLE_KEY, (old) =>
        old?.filter((p) => p.email !== email),
      );
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: ["action", "list-events"] },
        (old) => old?.filter((e) => e.overlayEmail !== email),
      );
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: OVERLAY_EVENTS_BATCH_KEY },
        (old) => old?.filter((e) => e.overlayEmail !== email),
      );

      return { previousPeople, previousEvents, previousBatchEvents };
    },
    onError: (_err, _email, context) => {
      const ctx = context as
        | {
            previousPeople?: OverlayPerson[];
            previousEvents?: Array<
              [readonly unknown[], CalendarEvent[] | undefined]
            >;
            previousBatchEvents?: Array<
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
      if (ctx?.previousBatchEvents) {
        for (const [key, data] of ctx.previousBatchEvents) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(OVERLAY_PEOPLE_KEY, data);
      invalidateOverlayStatusQueries(queryClient);
    },
  });
}
