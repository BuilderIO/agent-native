import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GoogleAuthStatus } from "@shared/api";

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
  return useQuery<{ url: string }>({
    queryKey: ["google-auth-url"],
    queryFn: async () => {
      const res = await fetch("/api/google/auth-url");
      if (!res.ok) throw new Error("Failed to get auth URL");
      return res.json();
    },
    enabled,
  });
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
