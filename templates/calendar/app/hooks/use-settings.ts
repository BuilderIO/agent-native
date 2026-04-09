import { useQueryClient } from "@tanstack/react-query";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import type { Settings } from "@shared/api";

export function useSettings() {
  return useActionQuery<Settings>("get-settings");
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useActionMutation<Settings, Partial<Settings>>("update-settings", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action", "get-settings"] });
    },
  });
}
