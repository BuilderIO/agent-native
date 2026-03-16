import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GoogleAuthStatus } from "@shared/api";
import { useEffect } from "react";

export function useGoogleAuthStatus() {
  return useQuery<GoogleAuthStatus>({
    queryKey: ["google-status"],
    queryFn: async () => {
      const res = await fetch("/api/google/status");
      if (!res.ok) throw new Error("Failed to fetch Google auth status");
      return res.json();
    },
  });
}

export function useGoogleAuthUrl(enabled = false) {
  const queryClient = useQueryClient();
  const query = useQuery<{ url: string }>({
    queryKey: ["google-auth-url"],
    queryFn: async () => {
      const harnessOrigin = new URLSearchParams(window.location.search).get(
        "harness_origin",
      );
      const callbackOrigin = harnessOrigin || window.location.origin;
      const res = await fetch(
        `/api/google/auth-url?redirect_uri=${encodeURIComponent(callbackOrigin + "/api/google/callback")}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || "Failed to get auth URL");
      }
      return res.json();
    },
    enabled,
    retry: false,
  });

  // Clear cached error when disabled so next enable triggers a fresh fetch
  useEffect(() => {
    if (!enabled && query.isError) {
      queryClient.resetQueries({ queryKey: ["google-auth-url"] });
    }
  }, [enabled, query.isError, queryClient]);

  return query;
}

export function useDisconnectGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/google/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Failed to disconnect Google");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-status"] });
    },
  });
}

export function useSyncGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/google/sync", { method: "POST" });
      if (!res.ok) throw new Error("Failed to sync Google Calendar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}
