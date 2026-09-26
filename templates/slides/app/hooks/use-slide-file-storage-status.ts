import { fetchFileUploadStatus } from "@agent-native/core/client/uploads";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export interface SlideFileStorageStatus {
  configured: boolean;
  builderReauthorizationRequired?: boolean;
}

export const SLIDE_FILE_STORAGE_STATUS_KEY = [
  "slides",
  "file-upload-status",
] as const;

export async function fetchSlideFileStorageStatus(): Promise<SlideFileStorageStatus> {
  const result = await fetchFileUploadStatus<Partial<SlideFileStorageStatus>>();
  if (result.state !== "available") {
    throw new Error("File storage status is unavailable");
  }
  if (typeof result.value?.configured !== "boolean") {
    throw new Error("File storage status response is invalid");
  }
  return {
    configured: result.value.configured,
    builderReauthorizationRequired:
      result.value.builderReauthorizationRequired === true,
  };
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
