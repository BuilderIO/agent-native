import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GoogleAuthStatus } from "@shared/api";
import { useEffect } from "react";

/**
 * Read a Response body defensively. Many failure modes (auth proxies returning
 * HTML 401 pages, empty 502s, etc.) caused the previous `await res.json()` to
 * throw an opaque "Unexpected end of JSON input". This helper:
 *   - returns the parsed JSON when the body is valid JSON
 *   - returns `undefined` for empty bodies / non-JSON content
 *   - never throws — caller decides how to react based on status + value
 */
async function readBody(res: Response): Promise<any> {
  const raw = await res.text().catch(() => "");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function bodyError(
  body: any,
  raw: string | undefined,
  res: Response,
  fallback: string,
): Error {
  const message =
    (body && (body.message || body.error)) ||
    (raw && raw.slice(0, 200)) ||
    res.statusText ||
    `${fallback} (HTTP ${res.status})`;
  const error = new Error(message);
  (error as any).status = res.status;
  return error;
}

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
  let parseFailed = false;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      // not JSON — leave body undefined
      parseFailed = true;
    }
  }
  if (!res.ok) {
    throw bodyError(body, raw, res, "Request failed");
  }
  // 2xx with a non-empty, non-JSON body — almost always a misconfigured proxy
  // or server returning an HTML page with status 200. Throw so callers (status
  // checks, auth URL hooks) surface the failure instead of silently treating
  // the response as "no data" / disconnected.
  if (parseFailed) {
    throw bodyError(body, raw, res, "Unexpected non-JSON response");
  }
  return (body ?? (null as unknown)) as T;
}

export function useGoogleAuthStatus() {
  return useQuery<GoogleAuthStatus>({
    queryKey: ["google-status"],
    queryFn: async () => {
      return fetchJson<GoogleAuthStatus>("/_agent-native/google/status");
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
      return fetchJson<{ url: string }>(
        `/_agent-native/google/auth-url?redirect_uri=${encodeURIComponent(getCallbackOrigin() + "/_agent-native/google/callback")}`,
      );
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
    },
  });
}

export function useSyncGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return fetchJson<unknown>("/_agent-native/google/sync", {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}
