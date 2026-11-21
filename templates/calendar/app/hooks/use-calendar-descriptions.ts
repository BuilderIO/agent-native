import { callAction } from "@agent-native/core/client/hooks";
import { surfaceMutationError } from "@agent-native/core/client/write-failure";
import { useMutation, useQueryClient } from "@tanstack/react-query";

type CalendarDescriptionTarget =
  | { accountEmail: string; feedId?: never }
  | { feedId: string; accountEmail?: never };

/** Saves, or with empty text clears, an account's or feed's description. */
export function useUpdateCalendarDescription() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: surfaceMutationError(),
    mutationFn: (args: CalendarDescriptionTarget & { description: string }) =>
      callAction("update-calendar-description", args, { method: "PUT" }),
    onSuccess: (_result, args) => {
      if (args.feedId) {
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-external-calendars"],
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
