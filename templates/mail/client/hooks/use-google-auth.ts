import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

interface GoogleAuthStatus {
  connected: boolean;
  accounts: Array<{ email: string; expiresAt?: string; photoUrl?: string }>;
}

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
      // Use the app's own origin for the callback, not the harness origin.
      // The harness doesn't proxy /api/google/callback, so the browser
      // must redirect directly to the app's server.
      const appOrigin = window.location.origin;
      const res = await fetch(
        `/api/google/auth-url?redirect_uri=${encodeURIComponent(appOrigin + "/api/google/callback")}`,
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
      queryClient.resetQueries({ queryKey: ["google-auth-url"] });
    }
  }, [enabled, query.isError, queryClient]);

  return query;
}

export function useDisconnectGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch("/api/google/disconnect", {
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
