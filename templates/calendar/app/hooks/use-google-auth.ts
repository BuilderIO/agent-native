import {
  agentNativePath,
  isInBuilderFrame,
  oauthRedirectUri,
} from "@agent-native/core/client";
import type { GoogleAuthStatus } from "@shared/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface DesktopAuthIssue {
  error?: string;
  message?: string;
  code?: string;
  accountId?: string;
  existingOwner?: string;
  attemptedOwner?: string;
}

interface DesktopAuthResult {
  token?: string;
  email?: string;
}

interface DesktopAuthStartOptions {
  addAccount?: boolean;
  previousAccountCount?: number;
}

interface DesktopAuthOptions {
  onError?: (issue: DesktopAuthIssue) => void;
  onSuccess?: (result: DesktopAuthResult) => void | Promise<void>;
  timeoutMs?: number;
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
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of [
      "error",
      "code",
      "accountId",
      "existingOwner",
      "attemptedOwner",
    ]) {
      if (typeof record[key] === "string") {
        (error as any)[key] = record[key];
      }
    }
    if (!(error as any).code && typeof record.error === "string") {
      (error as any).code = record.error;
    }
  }
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
      // not JSON — leave body undefined
      parseFailed = true;
    }
  }
  if (!res.ok) {
    throw bodyError(body, raw, res, "Request failed");
  }
  // 2xx but the body couldn't be read (stream interruption, decode failure,
  // etc.). Surface the failure rather than treating it as "no data".
  if (readFailed) {
    const cause =
      readError instanceof Error ? readError.message : String(readError);
    const error = new Error(`Unreadable ${res.status} response: ${cause}`);
    (error as any).status = res.status;
    throw error;
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
      return fetchJson<GoogleAuthStatus>(
        agentNativePath("/_agent-native/google/status"),
      );
    },
    staleTime: 30_000,
  });
}

export function useGoogleAuthUrl(enabled = false) {
  const queryClient = useQueryClient();
  const query = useQuery<{ url: string }>({
    queryKey: ["google-auth-url"],
    queryFn: async () => {
      const redirectUri = oauthRedirectUri("/_agent-native/google/callback");
      return fetchJson<{ url: string }>(
        agentNativePath(
          `/_agent-native/google/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`,
        ),
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
      const redirectUri = oauthRedirectUri("/_agent-native/google/callback");
      return fetchJson<{ url: string }>(
        agentNativePath(
          `/_agent-native/google/add-account/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`,
        ),
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

export function useGoogleDesktopAuth(options: DesktopAuthOptions = {}) {
  const { onError, onSuccess, timeoutMs = 120_000 } = options;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPending, setIsPending] = useState(false);
  const isDesktopGoogleAuth = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return (
      /AgentNativeDesktop/i.test(navigator.userAgent) && !isInBuilderFrame()
    );
  }, []);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => clearPoll, [clearPoll]);

  const startDesktopGoogleAuth = useCallback(
    (startOptions: DesktopAuthStartOptions = {}) => {
      if (!isDesktopGoogleAuth || typeof window === "undefined") return false;

      clearPoll();
      setIsPending(true);
      const flowId =
        globalThis.crypto?.randomUUID?.() ||
        Math.random().toString(36).slice(2) + Date.now().toString(36);
      const redirectUri = oauthRedirectUri("/_agent-native/google/callback");
      const params = new URLSearchParams({
        redirect_uri: redirectUri,
        desktop: "1",
        flow_id: flowId,
      });
      let popup: Window | null = null;
      const reportError = (issue: DesktopAuthIssue) => {
        clearPoll();
        setIsPending(false);
        onError?.(issue);
      };
      const authStartIssue = (err: unknown): DesktopAuthIssue => {
        const source = err as Partial<DesktopAuthIssue> | undefined;
        const message =
          err instanceof Error
            ? err.message
            : "Could not start Google sign-in.";
        return {
          code:
            typeof source?.code === "string"
              ? source.code
              : "desktop_auth_start_failed",
          error: typeof source?.error === "string" ? source.error : undefined,
          message,
          accountId:
            typeof source?.accountId === "string"
              ? source.accountId
              : undefined,
          existingOwner:
            typeof source?.existingOwner === "string"
              ? source.existingOwner
              : undefined,
          attemptedOwner:
            typeof source?.attemptedOwner === "string"
              ? source.attemptedOwner
              : undefined,
        };
      };
      const openAuthUrl = (url: string) => {
        if (popup && !popup.closed) {
          popup.location.href = url;
          return true;
        }
        popup = window.open(url, "_blank");
        return !!popup;
      };

      const startedAt = Date.now();
      const finish = async (result: DesktopAuthResult = {}) => {
        clearPoll();
        setIsPending(false);
        await onSuccess?.(result);
      };

      popup = window.open("about:blank", "_blank");
      if (!popup) {
        reportError({
          code: "popup_blocked",
          message:
            "Calendar could not open Google sign-in. Allow popups and try again.",
        });
        return true;
      }

      void (async () => {
        try {
          const path = startOptions.addAccount
            ? "/_agent-native/google/add-account/auth-url"
            : "/_agent-native/google/auth-url";
          const { url } = await fetchJson<{ url: string }>(
            agentNativePath(`${path}?${params.toString()}`),
            { credentials: "include" },
          );
          if (!openAuthUrl(url)) {
            reportError({
              code: "popup_blocked",
              message:
                "Calendar could not open Google sign-in. Allow popups and try again.",
            });
          }
        } catch (err) {
          popup?.close();
          reportError(authStartIssue(err));
        }
      })();

      pollRef.current = setInterval(async () => {
        try {
          const exchangeRes = await fetch(
            agentNativePath(
              `/_agent-native/auth/desktop-exchange?flow_id=${flowId}`,
            ),
            { credentials: "include" },
          );
          const exchange = await exchangeRes.json();
          if (exchange?.error) {
            clearPoll();
            setIsPending(false);
            onError?.(exchange);
            return;
          }
          if (exchange?.token) {
            await fetch(
              agentNativePath(
                `/_agent-native/auth/session?_session=${exchange.token}`,
              ),
              { credentials: "include" },
            );
            await finish({ token: exchange.token, email: exchange.email });
            return;
          }
        } catch {
          // Keep polling; the status endpoint below may still observe success.
        }

        try {
          const statusRes = await fetch(
            agentNativePath("/_agent-native/google/status"),
            { credentials: "include" },
          );
          if (statusRes.ok) {
            const status = (await statusRes.json()) as GoogleAuthStatus;
            const connected = startOptions.addAccount
              ? (status.accounts?.length ?? 0) >
                (startOptions.previousAccountCount ?? 0)
              : status.connected;
            if (connected) {
              await finish();
              return;
            }
          }
        } catch {
          // Keep polling until the timeout.
        }

        if (Date.now() - startedAt > timeoutMs) {
          reportError({
            code: "desktop_auth_timeout",
            message:
              "Google sign-in timed out. Finish sign-in in the browser or try again.",
          });
        }
      }, 1500);

      return true;
    },
    [clearPoll, isDesktopGoogleAuth, onError, onSuccess, timeoutMs],
  );

  return {
    isDesktopGoogleAuth,
    isGoogleDesktopAuthPending: isPending,
    startDesktopGoogleAuth,
  };
}

export function useDisconnectGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      return fetchJson<unknown>(
        agentNativePath("/_agent-native/google/disconnect"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
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
      return fetchJson<unknown>(agentNativePath("/_agent-native/google/sync"), {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action", "list-events"] });
    },
  });
}
