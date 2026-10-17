import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { isReferenceStorageReady } from "@/lib/prompt-file-uploads";

export interface SlideFileStorageStatus {
  configured: boolean;
}

export const SLIDE_FILE_STORAGE_STATUS_KEY = [
  "slides",
  "file-upload-status",
] as const;

export async function fetchSlideFileStorageStatus(): Promise<SlideFileStorageStatus> {
  return { configured: await isReferenceStorageReady() };
}

export function useSlideFileStorageStatus(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      void queryClient.invalidateQueries({
        queryKey: SLIDE_FILE_STORAGE_STATUS_KEY,
      });
    };
    window.addEventListener("agent-engine:configured-changed", refresh);
    return () => {
      window.removeEventListener("agent-engine:configured-changed", refresh);
    };
  }, [enabled, queryClient]);

  return useQuery({
    queryKey: SLIDE_FILE_STORAGE_STATUS_KEY,
    queryFn: fetchSlideFileStorageStatus,
    enabled,
    retry: false,
    staleTime: 30_000,
    // request-storm-allow: React Query coalesces all upload controls onto this one status key.
    refetchOnWindowFocus: true,
  });
}
