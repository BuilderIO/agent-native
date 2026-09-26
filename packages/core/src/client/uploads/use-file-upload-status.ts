import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  fetchFileUploadStatus,
  invalidateClientStatusRequest,
} from "../client-status-requests.js";

export const FILE_UPLOAD_STATUS_QUERY_KEY = [
  "agent-native",
  "file-upload-status",
] as const;

export async function readFileUploadStatus(): Promise<{ configured: boolean }> {
  const result = await fetchFileUploadStatus<{ configured?: unknown }>();
  if (
    result.state !== "available" ||
    typeof result.value?.configured !== "boolean"
  ) {
    throw new Error("File storage status is unavailable");
  }
  return { configured: result.value.configured };
}

export function useFileUploadStatus(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      invalidateClientStatusRequest("/_agent-native/file-upload/status");
      void queryClient.invalidateQueries({
        queryKey: FILE_UPLOAD_STATUS_QUERY_KEY,
      });
    };
    window.addEventListener("agent-engine:configured-changed", refresh);
    return () => {
      window.removeEventListener("agent-engine:configured-changed", refresh);
    };
  }, [enabled, queryClient]);

  return useQuery({
    queryKey: FILE_UPLOAD_STATUS_QUERY_KEY,
    queryFn: readFileUploadStatus,
    enabled,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
