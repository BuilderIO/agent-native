import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GoogleAuthStatus } from "@shared/api";
import { useEffect } from "react";

export function useGoogleAuthStatus() {
  return useQuery<GoogleAuthStatus>({
    queryKey: ["google-status"],
    queryFn: async () => {
      const res = await fetch("/_agent-native/google/status");
      if (!res.ok) throw new Error("Failed to fetch Google auth status");
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useGoogleAuthUrl(enabled = false) {
  const queryClient = useQueryClient();
  const query = useQuery<{ url: string }>({
    queryKey: ["google-auth-url"],
    queryFn: async () => {
      const { getCallbackOrigin } = await import("@agent-native/core/client");
      const res = await fetch(
        `/_agent-native/google/auth-url?redirect_uri=${encodeURIComponent(getCallbackOrigin() + "/_agent-native/google/callback")}`,
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

/** Hook for adding an additional Google account (user is already logged in). */
export function useGoogleAddAccountUrl(enabled = false) {
  const queryClient = useQueryClient();
  const query = useQuery<{ url: string }>({
    queryKey: ["google-add-account-url"],
    queryFn: async () => {
      const { getCallbackOrigin } = await import("@agent-native/core/client");
      const res = await fetch(
        `/_agent-native/google/add-account/auth-url?redirect_uri=${encodeURIComponent(getCallbackOrigin() + "/_agent-native/google/callback")}`,
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

  useEffect(() => {
    if (!enabled && query.isError) {
      queryClient.resetQueries({ queryKey: ["google-add-account-url"] });
    }
  }, [enabled, query.isError, queryClient]);

  return query;
}

export function useDisconnectGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch("/_agent-native/google/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
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
      const res = await fetch("/_agent-native/google/sync", { method: "POST" });
      if (!res.ok) throw new Error("Failed to sync Google Calendar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}
