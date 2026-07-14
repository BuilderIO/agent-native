import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

export type AttendeeTimezones = Record<string, string>;

export function useAttendeeTimezones() {
  return useActionQuery<AttendeeTimezones>("get-attendee-timezones");
}

export function useSetAttendeeTimezone() {
  const queryClient = useQueryClient();
  return useActionMutation<
    AttendeeTimezones,
    { email: string; timeZone?: string }
  >("set-attendee-timezone", {
    method: "PUT",
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["action", "get-attendee-timezones", undefined],
        data,
      );
    },
  });
}
