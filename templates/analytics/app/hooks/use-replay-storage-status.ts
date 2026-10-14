import { fetchFileUploadStatus } from "@agent-native/core/client/uploads";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export interface ReplayStorageStatus {
  configured: boolean;
  activeProvider?: { id: string; name: string } | null;
  builderConfigured?: boolean | null;
  builderUploadConfigured?: boolean | null;
}

export const REPLAY_STORAGE_STATUS_KEY = [
  "analytics",
  "replay-storage-status",
] as const;

export async function fetchReplayStorageStatus(): Promise<ReplayStorageStatus> {
  const result = await fetchFileUploadStatus<Partial<ReplayStorageStatus>>();
  if (result.state !== "available") {
    throw new Error("Replay storage status is unavailable");
  }
  if (typeof result.value?.configured !== "boolean") {
    throw new Error("Replay storage status response is invalid");
  }
  return {
    configured: result.value.configured,
    activeProvider: result.value.activeProvider ?? null,
    builderConfigured:
      typeof result.value.builderConfigured === "boolean"
        ? result.value.builderConfigured
        : null,
    builderUploadConfigured:
      typeof result.value.builderUploadConfigured === "boolean"
        ? result.value.builderUploadConfigured
        : null,
  };
}

export function useReplayStorageStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: REPLAY_STORAGE_STATUS_KEY,
    queryFn: fetchReplayStorageStatus,
    staleTime: 60_000,
    enabled: options?.enabled,
  });
}

export function usePrefetchReplayStorageStatus() {
  const qc = useQueryClient();
  useEffect(() => {
    void qc.prefetchQuery({
      queryKey: REPLAY_STORAGE_STATUS_KEY,
      queryFn: fetchReplayStorageStatus,
      staleTime: 60_000,
    });
  }, [qc]);
}
