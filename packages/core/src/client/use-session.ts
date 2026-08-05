import { useCallback, useEffect, useState } from "react";

import type { AuthSession } from "../server/auth.js";
import { setSentryUser, trackSessionStatus } from "./analytics.js";
import { fetchAuthSessionStatus } from "./client-status-requests.js";

export type { AuthSession };

/**
 * `"unavailable"` is the session endpoint being unreadable — a 5xx, a network
 * failure, or a timeout. It is NOT the visitor being signed out, and a caller
 * that collapses the two either strands the user on a spinner forever or
 * bounces a signed-in user to the sign-in page over a transient blip.
 */
export type SessionStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "unavailable";

interface UseSessionResult {
  session: AuthSession | null;
  isLoading: boolean;
  status: SessionStatus;
  error: Error | null;
  /** Restart the resolve loop, e.g. from a "Try again" control. */
  retry: () => void;
}

const SESSION_CACHE_TTL_MS = 30_000;
const SESSION_RETRY_DELAY_MS = 1_000;
const SESSION_MAX_ATTEMPTS = 4;
let cachedSession: AuthSession | null | undefined;
let cachedSessionAt = 0;
let sessionRequest: Promise<AuthSession | null | undefined> | undefined;
let trackedSessionIdentity: string | null | undefined;

function hasFreshSessionCache(): boolean {
  return (
    cachedSession !== undefined &&
    Date.now() - cachedSessionAt < SESSION_CACHE_TTL_MS
  );
}

function publishSessionIdentity(session: AuthSession | null): void {
  const identity = session?.userId ?? session?.email ?? null;
  if (trackedSessionIdentity !== identity) {
    trackedSessionIdentity = identity;
    if (session) {
      setSentryUser(
        {
          id: session.userId,
          email: session.email,
          username: session.name,
        },
        session.orgId ?? null,
      );
    } else {
      setSentryUser(null, null);
    }
  }
  trackSessionStatus(Boolean(session));
}

function fetchSharedSession(): Promise<AuthSession | null | undefined> {
  if (hasFreshSessionCache()) return Promise.resolve(cachedSession ?? null);
  if (sessionRequest) return sessionRequest;

  sessionRequest = (async () => {
    try {
      const result = await fetchAuthSessionStatus();
      if (result.state === "unavailable") return undefined;
      const data = result.value as AuthSession & { error?: unknown };
      const session = data.error ? null : (data as AuthSession);
      cachedSession = session;
      cachedSessionAt = Date.now();
      publishSessionIdentity(session);
      return session;
    } catch {
      return undefined;
    }
  })().finally(() => {
    sessionRequest = undefined;
  });

  return sessionRequest;
}

/**
 * Client-side hook to get the current auth session.
 *
 * Fetches the current session from `/_agent-native/auth/session` and returns
 * it, or `null` when unauthenticated. This behavior is the same in all
 * environments — there is no dev bypass and no `local@localhost` sentinel.
 *
 * Templates should use this instead of building their own auth context.
 */
export function useSession(): UseSessionResult {
  const cached = hasFreshSessionCache() ? (cachedSession ?? null) : null;
  const [session, setSession] = useState<AuthSession | null>(cached);
  const [status, setStatus] = useState<SessionStatus>(() => {
    if (!hasFreshSessionCache()) return "loading";
    return cached ? "authenticated" : "unauthenticated";
  });
  const [error, setError] = useState<Error | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setStatus("loading");
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const resolveSession = async () => {
      const resolved = await fetchSharedSession();
      if (cancelled) return;

      if (resolved === undefined) {
        attempts += 1;
        if (attempts >= SESSION_MAX_ATTEMPTS) {
          setError(
            new Error(`Could not read the session after ${attempts} attempts.`),
          );
          setStatus("unavailable");
          return;
        }
        retryTimer = setTimeout(() => {
          void resolveSession();
        }, SESSION_RETRY_DELAY_MS * attempts);
        return;
      }

      setSession(resolved);
      setError(null);
      setStatus(resolved ? "authenticated" : "unauthenticated");
    };

    void resolveSession();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [retryToken]);

  // Callers that only read `isLoading`/`session` (most of the codebase, not
  // yet migrated to `status`) must not see "unavailable" as "signed out" —
  // that bounces an authenticated user through sign-in-only UI over a
  // transient blip. Keeping `isLoading` true here reproduces this hook's
  // pre-existing behavior for those callers (an indefinite "still resolving"
  // instead of a wrong answer); only `status`-aware callers get the distinct
  // "unavailable" treatment with a retry affordance.
  const isLoading = status === "loading" || status === "unavailable";
  return { session, isLoading, status, error, retry };
}
