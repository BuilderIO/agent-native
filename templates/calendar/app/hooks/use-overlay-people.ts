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
    mutationFn: (email: string) =>
      callAction<OverlayPerson[]>(
        "remove-overlay-person",
        { email },
        { method: "PUT" },
      ),
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
