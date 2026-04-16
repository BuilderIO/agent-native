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
  // Track read failures separately from "no body" so a transport hiccup on a
  // 2xx response doesn't silently turn into a `null` success.
  let raw = "";
  let readFailed = false;
  let readError: unknown;
  try {
    raw = await res.text();
  } catch (err) {
    readFailed = true;
    readError = err;
  }
  let body: any = undefined;
  let parseFailed = false;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      // not JSON — leave body undefined and use the raw text in errors
      parseFailed = true;
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
  // 2xx but the body couldn't be read at all (stream interruption, decode
  // failure, etc.). Surface the failure rather than treating it as
  // "no data == not connected".
  if (readFailed) {
    const cause =
      readError instanceof Error ? readError.message : String(readError);
    const error = new Error(`Unreadable ${res.status} response: ${cause}`);
    (error as any).status = res.status;
    throw error;
  }
  // 2xx with a non-empty, non-JSON body — this is almost always a bug in the
  // auth proxy or server (e.g. HTML status page returned with status 200).
  // Throw so callers like useGoogleAuthUrl don't silently treat the user as
  // "not connected" or kick off a navigation to `undefined`.
  if (parseFailed) {
    const error = new Error(
      `Unexpected non-JSON response (HTTP ${res.status}): ${raw.slice(0, 200)}`,
    );
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
