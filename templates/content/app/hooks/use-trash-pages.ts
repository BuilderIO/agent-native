import { useActionMutation } from "@agent-native/core/client/hooks";
import type { TrashPagesResult } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
export type { TrashPagesResult, TrashPageResult } from "@shared/api";

export function useTrashPages() {
  const queryClient = useQueryClient();
  return useActionMutation<TrashPagesResult, { ids: string[] }>(
    "trash-documents",
    {
      onSettled: () => {
        // A lost response can follow a committed trash operation.
        void queryClient.invalidateQueries({ queryKey: ["action"] });
      },
    },
  );
}
