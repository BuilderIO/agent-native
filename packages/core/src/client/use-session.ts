import { useSyncExternalStore } from "react";

import type { AuthSession, AuthSessionResponse } from "../server/auth.js";
import { navigateForSession as navigateForSessionOnce } from "../shared/ssr-session-bootstrap.js";
import { setSentryUser, trackEvent, trackSessionStatus } from "./analytics.js";
import { agentNativeApiDisabledReason } from "./api-surface.js";
import {
  expireClientStatusResult,
  fetchAuthSessionStatus,
  invalidateClientStatusRequest,
  SESSION_RESULT_LIFETIME_MS,
} from "./client-status-requests.js";
import { getFrameOrigin, getFramePostMessageTargetOrigin } from "./frame.js";

export type { AuthSession };
export { isSessionNavigationPending } from "../shared/ssr-session-bootstrap.js";

/**
 * What the session endpoint said that the page acted on: a signed-out body,
 * an HTTP 401, or a signed-in answer. Recorded with every session-driven
 * navigation, so a redirect to sign-in names its evidence.
 */
export type SessionEvidence = "signed_in" | "signed_out_body" | "http_401";

export type SessionNavigationReason =
  | "signed_out"
  | "signed_in_app"
  | "sso_probe"
  | "beta_lane";

interface SessionResolution {
  evidence: SessionEvidence;
  /** Unreadable answers (5xx, timeout, bad body) before the definitive one. */
  readFailures: number;
  resolvedAfterMs: number;
}
let cachedEvidence: SessionEvidence | undefined;
let lastResolution: SessionResolution | undefined;

/**
 * The one way the client leaves a page because of what the session says (at
 * most once per document), and the one place that says why: `session_navigation`
 * carries the reason and, for a redirect to sign-in, the 401 or signed-out
 * evidence that decided it. The destination is never recorded.
 */
export function navigateForSession(
  href: string,
  reason?: SessionNavigationReason,
): boolean {
  const navigated = navigateForSessionOnce(href);
  if (navigated && reason) {
    try {
      trackEvent("session_navigation", {
        reason,
        ...(reason === "signed_out" && lastResolution
          ? {
              evidence: lastResolution.evidence,
              read_failures: lastResolution.readFailures,
              resolved_after_ms: lastResolution.resolvedAfterMs,
            }
          : {}),
        page_age_ms: Math.round(performance.now()),
      });
    } catch {
      // coercion-ok: telemetry must never stop the navigation it describes.
    }
  }
  return navigated;
}

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

const SESSION_CACHE_TTL_MS = SESSION_RESULT_LIFETIME_MS;
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
let staleSessionRecheck: ReturnType<typeof setTimeout> | undefined;
let signingOut = false;

/**
 * "Is this visitor signed in" is one page-wide fact, not a per-component
 * read. Every `useSession` consumer renders this snapshot, so a component
 * mounted late (a dialog, a route remount) sees the answer the gate already
 * has instead of starting at "loading" with `session: null` — the window in
 * which callers that test `!session` showed a sign-in prompt to a signed-in
 * user. A re-check keeps the last definitive answer on screen until the
 * server gives a new one; a failed re-check never turns into "signed out".
 */
interface SessionSnapshot {
  session: AuthSession | null;
  status: SessionStatus;
  error: Error | null;
}

const LOADING_SNAPSHOT: SessionSnapshot = {
  session: null,
  status: "loading",
  error: null,
};
let snapshot: SessionSnapshot = LOADING_SNAPSHOT;
const snapshotListeners = new Set<() => void>();
let resolveGeneration = 0;
let activeResolveGeneration = 0;

function isDefinitive(value: SessionSnapshot): boolean {
  return value.status === "authenticated" || value.status === "unauthenticated";
}

function publish(next: SessionSnapshot): void {
  if (snapshot.status === "signing-out") return;
  if (
    next.status === snapshot.status &&
    next.session === snapshot.session &&
    next.error === snapshot.error
  ) {
    return;
  }
  snapshot = next;
  for (const listener of snapshotListeners) listener();
}

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

function publishSessionIdentity(session: AuthSessionResponse | null): void {
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
          testIdentity: session.testIdentity,
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

function resetSessionCache(): void {
  sessionGeneration += 1;
  cachedSession = undefined;
  cachedSessionAt = 0;
  cachedEvidence = undefined;
  sessionRequest = undefined;
  clearTimeout(staleSessionRecheck);
  staleSessionRecheck = undefined;
}

function notifySessionSubscribers(): void {
  if (snapshotListeners.size === 0) {
    // Nobody is showing the last answer, so it is not kept as a hint either.
    resolveGeneration += 1;
    activeResolveGeneration = 0;
    if (snapshot.status !== "signing-out") snapshot = LOADING_SNAPSHOT;
    return;
  }
  void resolveSession();
}

function invalidateSessionCache(): void {
  resetSessionCache();
  invalidateClientStatusRequest(SESSION_STATUS_PATH);
  notifySessionSubscribers();
}

function rereadSession(): void {
  resetSessionCache();
  expireClientStatusResult(SESSION_STATUS_PATH);
  notifySessionSubscribers();
}

/**
 * Focus and visibility say only that the answer may be stale; logout, a peer
 * tab's invalidation, and a 401 each invalidate explicitly. A signed-in answer
 * inside its lifetime therefore stands for now, which keeps a hard load to one
 * session read, and is re-read when it expires if the tab still has focus. That
 * bounds how long a tab can show an identity changed somewhere that sends
 * neither a broadcast nor a 401. A signed-out answer is re-read at once,
 * because signing in elsewhere is what focus reports. A read already in flight
 * is shared rather than aborted, so analytics refreshing on the same focus
 * event does not cost a second request.
 */
function revalidateStaleSession(): void {
  if (!hasFreshSessionCache() || !cachedSession) {
    rereadSession();
    return;
  }
  if (staleSessionRecheck !== undefined) return;
  const answeredAt = cachedSessionAt;
  staleSessionRecheck = setTimeout(
    () => {
      staleSessionRecheck = undefined;
      // Already re-read since this focus: that answer is its own recheck.
      if (cachedSessionAt !== answeredAt) return;
      if (document.visibilityState !== "visible" || !document.hasFocus()) {
        return;
      }
      rereadSession();
    },
    Math.max(0, answeredAt + SESSION_CACHE_TTL_MS - Date.now()),
  );
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

  window.addEventListener("focus", revalidateStaleSession);
  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_INVALIDATION_STORAGE_KEY) {
      invalidateSessionCache();
      setTimeout(invalidateSessionCache, SESSION_CACHE_TTL_MS);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      revalidateStaleSession();
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
  snapshot = { session: null, status: "signing-out", error: null };
  for (const listener of snapshotListeners) listener();
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
      // Only the endpoint's own answer is definitive: a signed-out body or a
      // 401. A 403 is a signed-in visitor without access to this app, and a
      // 5xx, timeout, or unreadable body says nothing about the session.
      if (result.state === "unavailable" && result.status !== 401) {
        return { state: "unreadable" };
      }
      const data =
        result.state === "available"
          ? (result.value as AuthSessionResponse & { error?: unknown })
          : { error: "Not authenticated" };
      if (data.error !== undefined && data.error !== "Not authenticated") {
        return { state: "unreadable" };
      }
      const session =
        data.error === "Not authenticated"
          ? null
          : (data as AuthSessionResponse);
      cachedSession = session;
      cachedSessionAt = Date.now();
      cachedEvidence = session
        ? "signed_in"
        : result.state === "unavailable"
          ? "http_401"
          : "signed_out_body";
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
 * The one resolver behind the snapshot. Starting it again supersedes the run
 * in flight; it retries unreadable answers for a time budget and only then
 * reports "unavailable" — and only when there is no earlier definitive answer
 * to keep showing.
 */
async function resolveSession(): Promise<void> {
  if (signingOut) return;
  const generation = ++resolveGeneration;
  activeResolveGeneration = generation;
  const isCurrent = () => generation === resolveGeneration && !signingOut;
  const startedAt = monotonicNow();
  let failures = 0;
  try {
    for (;;) {
      const remainingAtStart =
        SESSION_RETRY_BUDGET_MS - (monotonicNow() - startedAt);
      const raced = await Promise.race([
        fetchSharedSession(),
        budgetExceededMarker(remainingAtStart),
      ]);
      if (!isCurrent()) return;

      let read: SessionRead;
      let hung = false;
      if (raced === RETRY_BUDGET_EXCEEDED) {
        // Abandon the hung read so the next attempt is a fresh request.
        resetSessionCache();
        invalidateClientStatusRequest(SESSION_STATUS_PATH);
        hung = true;
        read = { state: "unreadable" };
      } else {
        read = raced;
      }

      if (read.state === "resolved") {
        lastResolution = {
          evidence:
            cachedEvidence ?? (read.session ? "signed_in" : "signed_out_body"),
          readFailures: failures,
          resolvedAfterMs: Math.round(monotonicNow() - startedAt),
        };
        publish({
          session: read.session,
          status: read.session ? "authenticated" : "unauthenticated",
          error: null,
        });
        notifyParentAuthState(
          read.session ? "authenticated" : "unauthenticated",
        );
        return;
      }

      if (read.state === "unreadable") failures += 1;
      const remaining = SESSION_RETRY_BUDGET_MS - (monotonicNow() - startedAt);
      if (remaining <= 0) {
        const error = new Error(
          `Could not read the session after ${failures} attempts.`,
        );
        publish(
          isDefinitive(snapshot)
            ? { ...snapshot, error }
            : { session: null, status: "unavailable", error },
        );
        // A first read that hung past the budget keeps being retried in the
        // background, so a backend that comes back recovers on its own.
        if (hung && !isDefinitive(snapshot)) {
          queueMicrotask(() => void resolveSession());
        }
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
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!isCurrent()) return;
    }
  } finally {
    if (activeResolveGeneration === generation) activeResolveGeneration = 0;
  }
}

function retrySession(): void {
  if (signingOut) return;
  publish(LOADING_SNAPSHOT);
  void resolveSession();
}

function subscribeSession(listener: () => void): () => void {
  snapshotListeners.add(listener);
  if (!signingOut && activeResolveGeneration === 0) {
    if (!isDefinitive(snapshot)) {
      if (snapshot.status === "loading") void resolveSession();
    } else if (!hasFreshSessionCache()) {
      // The answer outlived its lifetime: keep showing it and re-check.
      rereadSession();
    }
  }
  return () => {
    snapshotListeners.delete(listener);
  };
}

function getSessionSnapshot(): SessionSnapshot {
  return snapshot;
}

function getServerSessionSnapshot(): SessionSnapshot {
  return LOADING_SNAPSHOT;
}

export function useSession(): UseSessionResult {
  installSessionInvalidationListeners();
  const current = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getServerSessionSnapshot,
  );
  if (signingOut) {
    return {
      session: null,
      isLoading: true,
      status: "signing-out",
      error: null,
      retry: retrySession,
    };
  }
  const isLoading =
    current.status === "loading" || current.status === "unavailable";
  return {
    session: current.session,
    isLoading,
    status: current.status,
    error: current.error,
    retry: retrySession,
  };
}
