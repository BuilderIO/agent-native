import { callAction } from "@agent-native/core/client/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export type VideoStorageMode = "own" | "hosted" | "none";

export type VideoStorageDenyReason =
  | "unverified"
  | "disposable"
  | "ip_velocity"
  | "global_daily_cap"
  | "global_storage_cap"
  | "disabled"
  | "exhausted"
  | "sign_in_required";

export type VideoStorageProviderError = "hosted_storage_unavailable";

export interface VideoStorageStatus {
  configured: boolean;
  activeProvider?: { id: string; name: string } | null;
  builderConfigured?: boolean;
  builderUploadConfigured?: boolean;
  builderReauthorizationRequired?: boolean;
  mode: VideoStorageMode;
  hostedRemaining: number;
  hostedLimit: number;
  maxClipBytes: number;
  maxClipDurationMs: number;
  providerError?: VideoStorageProviderError;
  denyReason?: VideoStorageDenyReason;
}

export const VIDEO_STORAGE_STATUS_KEY = [
  "clips",
  "video-storage-status",
] as const;

const denyReasons = new Set<VideoStorageDenyReason>([
  "unverified",
  "disposable",
  "ip_velocity",
  "global_daily_cap",
  "global_storage_cap",
  "disabled",
  "exhausted",
  "sign_in_required",
]);
const providerErrors = new Set<VideoStorageProviderError>([
  "hosted_storage_unavailable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeVideoStorageStatus(value: unknown): VideoStorageStatus {
  if (!isRecord(value)) {
    throw new Error("Video storage status response is invalid");
  }

  const { mode, configured, hostedRemaining, hostedLimit } = value;
  if (
    (mode !== "own" && mode !== "hosted" && mode !== "none") ||
    typeof configured !== "boolean" ||
    configured !== (mode !== "none") ||
    !Number.isSafeInteger(hostedRemaining) ||
    (hostedRemaining as number) < 0 ||
    (mode === "hosted" && (hostedRemaining as number) < 1) ||
    !Number.isSafeInteger(hostedLimit) ||
    (hostedLimit as number) < 0 ||
    (hostedRemaining as number) > (hostedLimit as number) ||
    !isNonNegativeFiniteNumber(value.maxClipBytes) ||
    !isNonNegativeFiniteNumber(value.maxClipDurationMs) ||
    (value.denyReason !== undefined &&
      !denyReasons.has(value.denyReason as VideoStorageDenyReason)) ||
    (value.providerError !== undefined &&
      !providerErrors.has(value.providerError as VideoStorageProviderError))
  ) {
    throw new Error("Video storage status response is invalid");
  }

  const activeProvider = value.activeProvider;
  if (
    activeProvider !== undefined &&
    activeProvider !== null &&
    (!isRecord(activeProvider) ||
      typeof activeProvider.id !== "string" ||
      typeof activeProvider.name !== "string")
  ) {
    throw new Error("Video storage status response is invalid");
  }

  return {
    configured,
    activeProvider:
      (activeProvider as VideoStorageStatus["activeProvider"]) ?? null,
    builderConfigured: value.builderConfigured === true,
    builderUploadConfigured: value.builderUploadConfigured === true,
    builderReauthorizationRequired:
      value.builderReauthorizationRequired === true,
    mode,
    hostedRemaining: hostedRemaining as number,
    hostedLimit: hostedLimit as number,
    maxClipBytes: value.maxClipBytes,
    maxClipDurationMs: value.maxClipDurationMs,
    ...(value.providerError
      ? { providerError: value.providerError as VideoStorageProviderError }
      : {}),
    ...(value.denyReason
      ? { denyReason: value.denyReason as VideoStorageDenyReason }
      : {}),
  };
}

export async function fetchVideoStorageStatus(options?: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<VideoStorageStatus> {
  const result = await callAction<unknown>(
    "get-video-storage-status" as any,
    {},
    {
      method: "GET",
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    },
  );
  return normalizeVideoStorageStatus(result);
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
    queryFn: ({ signal }) => fetchVideoStorageStatus({ signal }),
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
      queryFn: ({ signal }) => fetchVideoStorageStatus({ signal }),
      staleTime: 60_000,
    });
  }, [qc]);
}
