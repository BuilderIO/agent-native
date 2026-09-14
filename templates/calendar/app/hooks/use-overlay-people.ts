import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import type { CalendarEvent, OverlayPerson } from "@shared/api";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { OVERLAY_EVENTS_BATCH_KEY } from "@/hooks/use-events";
import { getNextOverlayColor } from "@/lib/overlay-colors";

const OVERLAY_PEOPLE_KEY = ["action", "get-overlay-people", undefined] as const;

export function useOverlayPeople() {
  return useActionQuery<OverlayPerson[]>("get-overlay-people");
}

/**
 * `update-overlay-people` is a full replacement, not a merge, so every
 * mutation below must start from the real current list. A plain
 * `getQueryData() ?? []` cannot tell "genuinely empty" apart from "never
 * fetched" or "failed to fetch" — either of the latter would silently wipe
 * every existing overlay person on the next save. `ensureQueryData` returns
 * the cached list when it is fresh, otherwise fetches it, and rejects the
 * mutation instead of guessing when that fetch fails.
 */
function getCurrentOverlayPeople(
  queryClient: QueryClient,
): Promise<OverlayPerson[]> {
  return queryClient.ensureQueryData<OverlayPerson[]>({
    queryKey: OVERLAY_PEOPLE_KEY,
    queryFn: () =>
      callAction<OverlayPerson[]>("get-overlay-people", undefined, {
        method: "GET",
      }),
  });
}

export function useAddOverlayPerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (person: { email: string; name?: string }) => {
      const current = await getCurrentOverlayPeople(queryClient);
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
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-events"],
      });
      // Adding this person can flip whether a booking-link host counts as
      // calendar-managed (e.g. the owner adding back a host who was showing
      // as manual) and can also make an existing peer reciprocal, so both
      // owner-scoped status reads must refetch rather than keep serving the
      // pre-add snapshot until an unrelated refetch happens to land.
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-host-overlay-status"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-overlay-reciprocity"],
      });
    },
  });
}

export function useUpdateOverlayPersonColor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, color }: { email: string; color: string }) => {
      const current = await getCurrentOverlayPeople(queryClient);
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
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: OVERLAY_PEOPLE_KEY,
      });
    },
  });
}

export function useRemoveOverlayPerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const current = await getCurrentOverlayPeople(queryClient);
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
      // Symmetric with useAddOverlayPerson: removal can also change whether a
      // host counts as calendar-managed or reciprocal.
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-host-overlay-status"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-overlay-reciprocity"],
      });
    },
  });
}
