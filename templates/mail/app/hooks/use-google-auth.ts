import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

interface GoogleAuthStatus {
  connected: boolean;
  accounts: Array<{ email: string; expiresAt?: string; photoUrl?: string }>;
}

/**
 * Defensive JSON fetch. Auth proxies sometimes return HTML 401/404 pages,
 * empty 502 bodies, or text errors — calling `.json()` on those throws an
 * opaque "Unexpected end of JSON input". This helper reads the body as text
 * first, attempts JSON.parse, and surfaces a clear error on non-2xx
 * responses without ever exploding on malformed bodies.
 */
async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error: ${cause}`);
  }
  const raw = await res.text().catch(() => "");
  let body: any = undefined;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      // not JSON — leave body undefined and use the raw text in errors
    }
  }
  if (!res.ok) {
    const message =
      (body && (body.message || body.error)) ||
      (raw && raw.slice(0, 200)) ||
      res.statusText ||
      `Request failed (HTTP ${res.status})`;
    const error = new Error(message);
    (error as any).status = res.status;
    throw error;
  }
  return (body ?? (null as unknown)) as T;
}

export function useGoogleAuthStatus() {
  return useQuery<GoogleAuthStatus>({
    queryKey: ["google-status"],
    queryFn: async () => {
      return fetchJson<GoogleAuthStatus>("/_agent-native/google/status");
    },
  });
}

export function useGoogleAuthUrl(enabled = false) {
  const queryClient = useQueryClient();
  const query = useQuery<{ url: string }>({
    queryKey: ["google-auth-url"],
    queryFn: async () => {
      const { getCallbackOrigin } = await import("@agent-native/core/client");
      return fetchJson<{ url: string }>(
        `/_agent-native/google/auth-url?redirect_uri=${encodeURIComponent(getCallbackOrigin() + "/_agent-native/google/callback")}`,
      );
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

/** Hook for adding an additional Google account (user is already logged in). */
export function useGoogleAddAccountUrl(enabled = false) {
  const queryClient = useQueryClient();
  const query = useQuery<{ url: string }>({
    queryKey: ["google-add-account-url"],
    queryFn: async () => {
      const { getCallbackOrigin } = await import("@agent-native/core/client");
      // Use the main callback URL — the server-side state param carries the
      // add-account flag so only one redirect URI needs Google Console registration.
      return fetchJson<{ url: string }>(
        `/_agent-native/google/add-account/auth-url?redirect_uri=${encodeURIComponent(getCallbackOrigin() + "/_agent-native/google/callback")}`,
      );
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
      return fetchJson<unknown>("/_agent-native/google/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-status"] });
      queryClient.invalidateQueries({ queryKey: ["emails"] });
      queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
  });
}
