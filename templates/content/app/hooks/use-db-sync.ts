import { useQueryClient } from "@tanstack/react-query";
import { useDbSync as useCoreDbSync } from "@agent-native/core/client";

export function useDbSync() {
  const queryClient = useQueryClient();

  useCoreDbSync({
    queryClient,
    queryKeys: [
      "action",
      "document-sync",
      "document-versions",
      "notion-connection",
    ],
  });
}
