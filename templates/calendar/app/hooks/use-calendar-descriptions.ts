import { callAction } from "@agent-native/core/client/hooks";
import { surfaceMutationError } from "@agent-native/core/client/write-failure";
import type { ExternalCalendar } from "@shared/api";
import {
  normalizeCalendarDescription,
  withFeedDescription,
} from "@shared/calendar-descriptions";
import { useMutation, useQueryClient } from "@tanstack/react-query";

type CalendarDescriptionTarget =
  | { accountEmail: string; feedId?: never }
  | { feedId: string; accountEmail?: never };

const EXTERNAL_CALENDARS_KEY = ["action", "list-external-calendars"];

export function useUpdateCalendarDescription() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: surfaceMutationError(),
    mutationFn: (args: CalendarDescriptionTarget & { description: string }) =>
      callAction("update-calendar-description", args, { method: "PUT" }),
    onMutate: async (args) => {
      if (!args.feedId) return;
      await queryClient.cancelQueries({ queryKey: EXTERNAL_CALENDARS_KEY });
      const description = normalizeCalendarDescription(args.description);
      queryClient.setQueriesData<ExternalCalendar[]>(
        { queryKey: EXTERNAL_CALENDARS_KEY },
        (feeds) =>
          feeds?.map((feed) =>
            feed.id === args.feedId
              ? withFeedDescription(feed, description)
              : feed,
          ),
      );
    },
    onSettled: (_result, _error, args) => {
      if (args.feedId) {
        void queryClient.invalidateQueries({
          queryKey: EXTERNAL_CALENDARS_KEY,
        });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["google-status"] });
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-google-calendars"],
      });
    },
  });
}
