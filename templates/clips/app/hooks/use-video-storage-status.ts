import { fetchFileUploadStatus } from "@agent-native/core/client/uploads";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export interface VideoStorageStatus {
  configured: boolean;
  activeProvider?: { id: string; name: string } | null;
  builderConfigured?: boolean;
  builderUploadConfigured?: boolean;
  builderReauthorizationRequired?: boolean;
}

export const VIDEO_STORAGE_STATUS_KEY = [
  "clips",
  "video-storage-status",
] as const;

export async function fetchVideoStorageStatus(): Promise<VideoStorageStatus> {
  const result = await fetchFileUploadStatus<Partial<VideoStorageStatus>>();
  if (result.state !== "available") {
    throw new Error("Video storage status is unavailable");
  }
  if (typeof result.value?.configured !== "boolean") {
    throw new Error("Video storage status response is invalid");
  }
  return {
    configured: result.value.configured,
    activeProvider: result.value.activeProvider ?? null,
    builderConfigured: result.value.builderConfigured ?? false,
    builderUploadConfigured: result.value.builderUploadConfigured ?? false,
    builderReauthorizationRequired:
      result.value.builderReauthorizationRequired ?? false,
  };
}

export function useVideoStorageStatus(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      void queryClient.invalidateQueries({
        queryKey: VIDEO_STORAGE_STATUS_KEY,
      });
    };
    window.addEventListener("agent-engine:configured-changed", refresh);
    return () => {
      window.removeEventListener("agent-engine:configured-changed", refresh);
    };
  }, [enabled, queryClient]);

  return useQuery({
    queryKey: VIDEO_STORAGE_STATUS_KEY,
    queryFn: fetchVideoStorageStatus,
    enabled,
    staleTime: 60_000,
    // request-storm-allow: React Query coalesces all storage controls onto this one status key.
    refetchOnWindowFocus: true,
  });
}

export function usePrefetchVideoStorageStatus() {
  const qc = useQueryClient();
  useEffect(() => {
    void qc.prefetchQuery({
      queryKey: VIDEO_STORAGE_STATUS_KEY,
      queryFn: fetchVideoStorageStatus,
      staleTime: 60_000,
    });
  }, [qc]);
}
