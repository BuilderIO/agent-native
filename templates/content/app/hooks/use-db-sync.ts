import { useDbSync as useCoreDbSync } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

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
