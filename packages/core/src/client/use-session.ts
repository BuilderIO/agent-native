import { useCallback, useEffect, useState } from "react";

import type { AuthSession } from "../server/auth.js";
import { setSentryUser, trackSessionStatus } from "./analytics.js";
import { agentNativeApiDisabledReason } from "./api-surface.js";
import {
  fetchAuthSessionStatus,
  invalidateClientStatusRequest,
} from "./client-status-requests.js";
import { getFrameOrigin, getFramePostMessageTargetOrigin } from "./frame.js";

export type { AuthSession };

export type SessionStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "unavailable"
  | "signing-out";

interface UseSessionResult {
  session: AuthSession | null;
  isLoading: boolean;
  status: SessionStatus;
  error: Error | null;
  retry: () => void;
}

const SESSION_CACHE_TTL_MS = 30_000;
const SESSION_RETRY_BUDGET_MS = 30_000;
const SESSION_RETRY_BASE_DELAY_MS = 500;
const SESSION_RETRY_MAX_DELAY_MS = 5_000;
const SESSION_INVALIDATION_STORAGE_KEY = "agent-native:session-invalidated";
const SESSION_STATUS_PATH = "/_agent-native/auth/session";
let cachedSession: AuthSession | null | undefined;
let cachedSessionAt = 0;
let sessionRequest: Promise<SessionRead> | undefined;
let trackedSessionIdentity: string | null | undefined;
let trackedSessionAuthUserId: string | undefined;
let sessionGeneration = 0;
let sessionInvalidationListenersInstalled = false;
const sessionInvalidationSubscribers = new Set<() => void>();
let signingOut = false;

type SessionRead =
  | { state: "resolved"; session: AuthSession | null }
  | { state: "superseded" }
  | { state: "unreadable" };

function monotonicNow(): number {
  return performance.now();
}

const RETRY_BUDGET_EXCEEDED = Symbol("retry-budget-exceeded");

function budgetExceededMarker(
  remainingMs: number,
): Promise<typeof RETRY_BUDGET_EXCEEDED> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(RETRY_BUDGET_EXCEEDED), Math.max(remainingMs, 0));
  });
}

function hasFreshSessionCache(): boolean {
  return (
    cachedSession !== undefined &&
    Date.now() - cachedSessionAt < SESSION_CACHE_TTL_MS
  );
}

function publishSessionIdentity(session: AuthSession | null): void {
  const identity = session?.userId ?? session?.email ?? null;
  const authUserId = session?.authUserId;
  if (
    trackedSessionIdentity !== identity ||
    trackedSessionAuthUserId !== authUserId
  ) {
    trackedSessionIdentity = identity;
    trackedSessionAuthUserId = authUserId;
    if (session) {
      setSentryUser(
        {
          id: session.userId,
          email: session.email,
          username: session.name,
          authUserId,
        },
        session.orgId ?? null,
      );
    } else {
      setSentryUser(null, null);
    }
  }
  trackSessionStatus(Boolean(session));
}

function notifyParentAuthState(
  status: "authenticated" | "unauthenticated",
): void {
  if (typeof window === "undefined" || window.parent === window) return;
  if (!getFrameOrigin()) return;
  const targetOrigin = getFramePostMessageTargetOrigin();
  if (!targetOrigin) return;
  try {
    window.parent.postMessage(
      {
        type: "agentNative.authState",
        data: { status },
      },
      targetOrigin,
    );
    // coercion-ok: Posting auth state is best-effort when an embedded host is being detached.
  } catch {
    // A host may revoke the frame while the session request is settling.
  }
}

function invalidateSessionCache(): void {
  sessionGeneration += 1;
  cachedSession = undefined;
  cachedSessionAt = 0;
  sessionRequest = undefined;
  invalidateClientStatusRequest(SESSION_STATUS_PATH);
  for (const subscriber of sessionInvalidationSubscribers) subscriber();
}

function installSessionInvalidationListeners(): void {
  if (
    sessionInvalidationListenersInstalled ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }
  sessionInvalidationListenersInstalled = true;

  window.addEventListener("focus", invalidateSessionCache);
  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_INVALIDATION_STORAGE_KEY) {
      invalidateSessionCache();
      setTimeout(invalidateSessionCache, SESSION_CACHE_TTL_MS);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      invalidateSessionCache();
    }
  });
}

export function notifySessionInvalidated(): void {
  if (typeof window === "undefined") return;
  installSessionInvalidationListeners();
  invalidateSessionCache();
  try {
    window.localStorage.setItem(
      SESSION_INVALIDATION_STORAGE_KEY,
      `${Date.now()}:${Math.random()}`,
    );
  } catch (error) {
    console.warn("Unable to broadcast session invalidation", error);
  }
}

export function isSigningOut(): boolean {
  return signingOut;
}

const UNAUTHORIZED_RECHECK_MIN_INTERVAL_MS = 5_000;
let lastUnauthorizedRecheckAt = 0;

/**
 * Re-resolve the session because an authenticated request came back 401.
 *
 * `status` is only written when a session fetch resolves, so a 401 anywhere
 * else leaves every mounted consumer holding the previous `"authenticated"`
 * answer. The app shell stays mounted over a session the server no longer
 * recognises, and each data query paints its own generic load error instead of
 * the visitor being sent to sign in — which is what a stale cookie surviving
 * logout looks like on screen. Re-reading the session lets the gate reach the
 * truth and redirect.
 *
 * This asks the server rather than forcing `"unauthenticated"` from here: a
 * 401 can also come from one request a live session is not allowed to make,
 * and assuming otherwise would sign that visitor out of a working session.
 * Throttled because one screen can fail many requests at once, and each
 * invalidation schedules a fresh read.
 */
export function recheckSessionAfterUnauthorized(): void {
  if (typeof window === "undefined") return;
  if (signingOut) return;
  const now = Date.now();
  if (now - lastUnauthorizedRecheckAt < UNAUTHORIZED_RECHECK_MIN_INTERVAL_MS) {
    return;
  }
  lastUnauthorizedRecheckAt = now;
  installSessionInvalidationListeners();
  invalidateSessionCache();
}

export function beginSignOut(): void {
  signingOut = true;
  publishSessionIdentity(null);
  invalidateSessionCache();
}

export function completeSignOut(): void {
  notifyParentAuthState("unauthenticated");
  notifySessionInvalidated();
}

function fetchSharedSession(): Promise<SessionRead> {
  if (signingOut) return Promise.resolve({ state: "resolved", session: null });
  if (agentNativeApiDisabledReason()) {
    return Promise.resolve({ state: "resolved", session: null });
  }
  if (hasFreshSessionCache()) {
    return Promise.resolve({
      state: "resolved",
      session: cachedSession ?? null,
    });
  }
  if (sessionRequest) return sessionRequest;

  const requestGeneration = sessionGeneration;
  let request: Promise<SessionRead>;
  const requestResult = (async (): Promise<SessionRead> => {
    try {
      const result = await fetchAuthSessionStatus();
      if (requestGeneration !== sessionGeneration) {
        return { state: "superseded" };
      }
      if (result.state === "unavailable") return { state: "unreadable" };
      const data = result.value as AuthSession & { error?: unknown };
      const session = data.error ? null : (data as AuthSession);
      cachedSession = session;
      cachedSessionAt = Date.now();
      publishSessionIdentity(session);
      return { state: "resolved", session };
    } catch {
      return { state: "unreadable" };
    }
  })();
  request = requestResult.finally(() => {
    if (sessionRequest === request) sessionRequest = undefined;
  });

  sessionRequest = request;

  return sessionRequest;
}

export function useSession(): UseSessionResult {
  installSessionInvalidationListeners();
  const cached = hasFreshSessionCache() ? (cachedSession ?? null) : null;
  const [session, setSession] = useState<AuthSession | null>(cached);
  const [status, setStatus] = useState<SessionStatus>(() => {
    if (!hasFreshSessionCache()) return "loading";
    return cached ? "authenticated" : "unauthenticated";
  });
  const [error, setError] = useState<Error | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [invalidationToken, setInvalidationToken] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setStatus("loading");
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    const subscriber = () => {
      setInvalidationToken((token) => token + 1);
    };
    sessionInvalidationSubscribers.add(subscriber);
    return () => {
      sessionInvalidationSubscribers.delete(subscriber);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const startedAt = monotonicNow();

    const resolveSession = async () => {
      const remainingAtStart =
        SESSION_RETRY_BUDGET_MS - (monotonicNow() - startedAt);
      const raced = await Promise.race([
        fetchSharedSession(),
        budgetExceededMarker(remainingAtStart),
      ]);
      if (cancelled) return;

      let read: SessionRead;
      if (raced === RETRY_BUDGET_EXCEEDED) {
        invalidateSessionCache();
        read = { state: "unreadable" };
      } else {
        read = raced;
      }

      if (read.state !== "resolved") {
        if (read.state === "unreadable") failures += 1;
        const remaining =
          SESSION_RETRY_BUDGET_MS - (monotonicNow() - startedAt);
        if (remaining <= 0) {
          setError(
            new Error(`Could not read the session after ${failures} attempts.`),
          );
          setStatus("unavailable");
          return;
        }
        const delay =
          read.state === "superseded"
            ? 0
            : Math.min(
                SESSION_RETRY_BASE_DELAY_MS * 2 ** (failures - 1),
                SESSION_RETRY_MAX_DELAY_MS,
                remaining,
              );
        retryTimer = setTimeout(() => {
          void resolveSession();
        }, delay);
        return;
      }

      const resolved = read.session;
      setSession(resolved);
      setError(null);
      setStatus(resolved ? "authenticated" : "unauthenticated");
      notifyParentAuthState(resolved ? "authenticated" : "unauthenticated");
    };

    void resolveSession();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [invalidationToken, retryToken]);

  if (signingOut) {
    return {
      session: null,
      isLoading: true,
      status: "signing-out",
      error: null,
      retry,
    };
  }
  const isLoading = status === "loading" || status === "unavailable";
  return { session, isLoading, status, error, retry };
}
