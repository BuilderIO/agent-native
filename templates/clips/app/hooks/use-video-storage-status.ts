import { agentNativePath } from "@agent-native/core/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export interface VideoStorageStatus {
  configured: boolean;
  activeProvider?: { id: string; name: string } | null;
  builderConfigured?: boolean;
}

export const VIDEO_STORAGE_STATUS_KEY = [
  "clips",
  "video-storage-status",
] as const;

export async function fetchVideoStorageStatus(): Promise<VideoStorageStatus> {
  let uploadStatus: VideoStorageStatus | null = null;
  try {
    const r = await fetch(agentNativePath("/_agent-native/file-upload/status"));
    uploadStatus = r.ok ? ((await r.json()) as VideoStorageStatus) : null;
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

export function useVideoStorageStatus() {
  return useQuery({
    queryKey: VIDEO_STORAGE_STATUS_KEY,
    queryFn: fetchVideoStorageStatus,
    staleTime: 60_000,
  });
}

export function usePrefetchVideoStorageStatus() {
  const qc = useQueryClient();
  useEffect(() => {
    qc.prefetchQuery({
      queryKey: VIDEO_STORAGE_STATUS_KEY,
      queryFn: fetchVideoStorageStatus,
      staleTime: 60_000,
    });
  }, [qc]);
}
