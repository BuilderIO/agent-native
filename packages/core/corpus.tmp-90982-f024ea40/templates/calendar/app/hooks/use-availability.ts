import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import type { AvailabilityConfig } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";

export function useAvailability() {
  return useActionQuery<AvailabilityConfig>("get-availability");
}

export function useUpdateAvailability() {
  const queryClient = useQueryClient();
  return useActionMutation<AvailabilityConfig, AvailabilityConfig>(
    "update-availability",
    {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["action", "get-availability"],
        });
      },
    },
  );
}
