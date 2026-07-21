import { useEffect, useState } from "react";

import type { AuthSession } from "../server/auth.js";
import { setSentryUser, trackSessionStatus } from "./analytics.js";
import { agentNativePath } from "./api-path.js";

export type { AuthSession };

interface UseSessionResult {
  session: AuthSession | null;
  isLoading: boolean;
}

const SESSION_CACHE_TTL_MS = 30_000;
const SESSION_RETRY_DELAY_MS = 1_000;
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
      const res = await fetch(agentNativePath("/_agent-native/auth/session"));
      if (!res.ok) return undefined;

      const data = await res.json();
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
  const [isLoading, setIsLoading] = useState(!hasFreshSessionCache());

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const resolveSession = async () => {
      const resolved = await fetchSharedSession();
      if (cancelled) return;

      if (resolved === undefined) {
        retryTimer = setTimeout(() => {
          void resolveSession();
        }, SESSION_RETRY_DELAY_MS);
        return;
      }

      setSession(resolved);
      setIsLoading(false);
    };

    void resolveSession();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return { session, isLoading };
}
