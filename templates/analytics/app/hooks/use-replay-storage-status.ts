import { agentNativePath } from "@agent-native/core/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export interface ReplayStorageStatus {
  configured: boolean;
  activeProvider?: { id: string; name: string } | null;
  builderConfigured?: boolean;
}

export const REPLAY_STORAGE_STATUS_KEY = [
  "analytics",
  "replay-storage-status",
] as const;

export async function fetchReplayStorageStatus(): Promise<ReplayStorageStatus> {
  let uploadStatus: ReplayStorageStatus | null = null;
  try {
    const r = await fetch(agentNativePath("/_agent-native/file-upload/status"));
    uploadStatus = r.ok ? ((await r.json()) as ReplayStorageStatus) : null;
    if (uploadStatus?.configured) return uploadStatus;
  } catch {
    // Fall through to the Builder status check.
  }

  try {
    const r = await fetch(agentNativePath("/_agent-native/builder/status"));
    const builderStatus = r.ok
      ? ((await r.json()) as { configured?: boolean })
      : null;
    if (builderStatus?.configured) {
      return {
        configured: true,
        activeProvider: { id: "builder", name: "Builder.io" },
        builderConfigured: true,
      };
    }
  } catch {
    // Treat an unreachable status route as not configured.
  }

  return {
    configured: false,
    activeProvider: uploadStatus?.activeProvider ?? null,
    builderConfigured: uploadStatus?.builderConfigured ?? false,
  };
}

export function useReplayStorageStatus() {
  return useQuery({
    queryKey: REPLAY_STORAGE_STATUS_KEY,
    queryFn: fetchReplayStorageStatus,
    staleTime: 60_000,
  });
}

export function usePrefetchReplayStorageStatus() {
  const qc = useQueryClient();
  useEffect(() => {
    qc.prefetchQuery({
      queryKey: REPLAY_STORAGE_STATUS_KEY,
      queryFn: fetchReplayStorageStatus,
      staleTime: 60_000,
    });
  }, [qc]);
}
