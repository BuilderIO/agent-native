import { useMutation, useQueryClient } from "@tanstack/react-query";

import { agentNativePath } from "../api-path.js";
import {
  resourceWriteError,
  type Resource,
} from "../resources/use-resources.js";

export function useUploadResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch(
        agentNativePath("/_agent-native/resources/upload"),
        {
          method: "POST",
          body: formData,
        },
      );
      if (!res.ok) {
        throw await resourceWriteError(res, `Upload failed: ${res.statusText}`);
      }
      return res.json() as Promise<Resource>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
  });
}
