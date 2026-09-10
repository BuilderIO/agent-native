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

/**
 * `"unavailable"` is the session endpoint being unreadable — a 5xx, a network
 * failure, or a timeout. It is NOT the visitor being signed out, and a caller
 * that collapses the two either strands the user on a spinner forever or
 * bounces a signed-in user to the sign-in page over a transient blip.
 *
 * `"signing-out"` is the user having asked to leave. It is NOT
 * `"unauthenticated"`: the server session may still be live for the length of
 * the revoke request, and the sign-out flow — not a gate — owns the navigation
 * away. Collapsing it into `"authenticated"` (which is what a cache
 * invalidation alone does) leaves the app shell mounted with no cookie for the
 * whole revoke-plus-navigate window, long enough for its queries to 401 and
 * paint a load failure over the app the user is trying to leave.
 */
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
  /** Restart the resolve loop, e.g. from a "Try again" control. */
  retry: () => void;
}

const SESSION_CACHE_TTL_MS = 30_000;
/**
 * How long the resolve loop keeps trying before it tells the visitor the
 * server is unreachable: a wall-clock budget, deliberately not an attempt
 * count. An attempt count makes patience depend on how the backend fails. A
 * hung endpoint bought ~66s of retries, while an endpoint answering 503
 * instantly (a session lookup against a cold database, a deploy swap, a
 * connection-pool blip) spent every attempt in ~6s and painted the
 * "couldn't reach the server" screen over a backend that was about to come
 * back. The fast-failing case is the recoverable one, so it must not be the
 * impatient one.
 */
const SESSION_RETRY_BUDGET_MS = 30_000;
const SESSION_RETRY_BASE_DELAY_MS = 500;
const SESSION_RETRY_MAX_DELAY_MS = 5_000;
const SESSION_INVALIDATION_STORAGE_KEY = "agent-native:session-invalidated";
const SESSION_STATUS_PATH = "/_agent-native/auth/session";
let cachedSession: AuthSession | null | undefined;
let cachedSessionAt = 0;
let sessionRequest: Promise<SessionRead> | undefined;
let trackedSessionIdentity: string | null | undefined;
let sessionGeneration = 0;
let sessionInvalidationListenersInstalled = false;
const sessionInvalidationSubscribers = new Set<() => void>();
// One-way for the life of the document. A sign-out is a decision, not a
// reading, so nothing may flip this back — including an in-flight session
// response that was issued while the cookie was still valid and lands after.
let signingOut = false;

/**
 * The outcome of one read of the session endpoint.
 *
 * A superseded read is its own state so an ordinary cache invalidation (a tab
 * focus, a visibility change, a sign-out broadcast from another tab) is not
 * filed as a failed read. Nothing was unreadable in that case; the answer
 * simply arrived for a generation nobody is waiting on any more, and the right
 * response is to ask again rather than to spend the retry budget.
 */
type SessionRead =
  | { state: "resolved"; session: AuthSession | null }
  | { state: "superseded" }
  | { state: "unreadable" };

/** Elapsed-time source for the retry budget; immune to wall-clock jumps. */
function monotonicNow(): number {
  return performance.now();
}

/**
 * Resolves to an unreadable read once `remainingMs` elapses. Races against
 * the actual session read so a read starting near the retry budget cannot
 * itself run past that budget on the client request timeout.
 */
function budgetExceededRead(remainingMs: number): Promise<SessionRead> {
  return new Promise((resolve) => {
    setTimeout(
      () => resolve({ state: "unreadable" }),
      Math.max(remainingMs, 0),
    );
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

function notifyParentAuthState(
  status: "authenticated" | "unauthenticated",
): void {
  if (typeof window === "undefined" || window.parent === window) return;
  // The frame-origin handshake validates the direct parent before this state
  // crosses the frame boundary. Opaque sandbox frames still require "*".
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

/** Tell mounted session consumers to re-check auth after a logout. */
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

/** True once this document has started signing out. Never true again after. */
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
  // Already leaving. The sign-out flow owns the navigation from here, and
  // re-reading could only reintroduce the session this document gave up.
  if (signingOut) return;
  const now = Date.now();
  if (now - lastUnauthorizedRecheckAt < UNAUTHORIZED_RECHECK_MIN_INTERVAL_MS) {
    return;
  }
  lastUnauthorizedRecheckAt = now;
  installSessionInvalidationListeners();
  invalidateSessionCache();
}

/**
 * Enter the terminal `"signing-out"` state for this document.
 *
 * Call this BEFORE revoking the server session, not after. Invalidating the
 * cache instead only asks mounted consumers to re-read, which keeps answering
 * `"authenticated"` from the previous read until the network replies — and the
 * app shell stays mounted, and its queries 401. Prefer `signOut()` from
 * `sign-out.ts`, which sequences this with the revoke and the navigation.
 */
export function beginSignOut(): void {
  signingOut = true;
  publishSessionIdentity(null);
  invalidateSessionCache();
}

/** Notify other browsing contexts after the server has confirmed revocation. */
export function completeSignOut(): void {
  notifyParentAuthState("unauthenticated");
  notifySessionInvalidated();
}

function fetchSharedSession(): Promise<SessionRead> {
  // Already leaving: the answer is known, and asking the server again can only
  // reintroduce the session this document just gave up.
  if (signingOut) return Promise.resolve({ state: "resolved", session: null });
  // A surface with no agent-native backend is genuinely signed out, which is a
  // resolved answer, not an unreadable endpoint to retry until it gives up.
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
      // Check the generation first: a failed read from an invalidated
      // generation proved nothing about the current one and must not spend
      // its retry budget, regardless of which way the stale request failed.
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
      const read = await Promise.race([
        fetchSharedSession(),
        budgetExceededRead(remainingAtStart),
      ]);
      if (cancelled) return;

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
        // A superseded read cost nothing and proved nothing, so it earns an
        // immediate re-ask instead of a backoff step. Clamp to what's left of
        // the budget so a near-boundary backoff step can't itself push the
        // next check past the advertised wall-clock budget.
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

  // Read after every hook so the hook order stays unconditional. A sign-out
  // overrides whatever the last completed read said: `status` state is only
  // written when a fetch resolves, so without this the previous
  // "authenticated" answer (and its session object) stays on screen for the
  // whole revoke-plus-navigate window.
  if (signingOut) {
    return {
      session: null,
      isLoading: true,
      status: "signing-out",
      error: null,
      retry,
    };
  }
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
