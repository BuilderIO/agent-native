import { createContext, useContext, useSyncExternalStore } from "react";

import type { AuthSession, AuthSessionResponse } from "../server/auth.js";
import {
  navigateForSession as navigateForSessionOnce,
  readSessionInvalidationMarker,
  SESSION_BOOTSTRAP_INVALIDATION_GLOBAL,
  SESSION_INVALIDATION_STORAGE_KEY,
} from "../shared/ssr-session-bootstrap.js";
import { setSentryUser, trackEvent, trackSessionStatus } from "./analytics.js";
import { agentNativeApiDisabledReason } from "./api-surface.js";
import {
  expireClientStatusResult,
  fetchAuthSessionStatus,
  invalidateClientStatusRequest,
  SESSION_RESULT_LIFETIME_MS,
  statusResultAnsweredAt,
} from "./client-status-requests.js";
import {
  FETCH_TRANSPORT_CHANGED_EVENT,
  fetchTransport,
  type FetchTransport,
} from "./fetch-transport.js";
import { getFrameOrigin, getFramePostMessageTargetOrigin } from "./frame.js";
import { recordSessionIdentity } from "./session-identity.js";

export type { AuthSession };

interface ClientAuthSession extends AuthSession {
  identitySsoEnabled?: boolean;
}
export {
  hasSessionHint,
  isSessionNavigationPending,
} from "../shared/ssr-session-bootstrap.js";

/**
 * True while the app tree is mounted hidden ahead of the session read (a hinted
 * load). Identity-scoped onboarding reads and their events hold until it clears,
 * so they never record under the anonymous fallback identity. Other effects in
 * the tree run during the preload; each one must be safe before the session.
 */
export const SessionPreloadContext = createContext(false);

export function useSessionPreloading(): boolean {
  return useContext(SessionPreloadContext);
}

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
  session: ClientAuthSession | null;
  isLoading: boolean;
  status: SessionStatus;
  error: Error | null;
  retry: () => void;
}

const SESSION_CACHE_TTL_MS = SESSION_RESULT_LIFETIME_MS;
const SESSION_RETRY_BUDGET_MS = 30_000;
const SESSION_RETRY_BASE_DELAY_MS = 500;
const SESSION_RETRY_MAX_DELAY_MS = 5_000;
const SESSION_STATUS_PATH = "/_agent-native/auth/session";
let cachedSession: ClientAuthSession | null | undefined;
let cachedSessionAt = 0;
let sessionRequest: Promise<SessionRead> | undefined;
let sessionRequestTransport: FetchTransport | undefined;
let trackedSessionIdentity: string | null | undefined;
let trackedSessionAuthUserId: string | undefined;
// The page load's own session read is the only one sent with the cookies a
// request made before the session was known also carried. A retry or a reset
// replaces it for the life of the document.
let firstSessionReadUnsent = true;
let cachedSessionFromFirstRead = false;
// Set once a retry or a reset replaces the first read, answered or not.
let firstSessionReadReplaced = false;
const firstSessionReadAnswerListeners = new Set<() => void>();

/*
 * Whom a request was answered for
 * ===============================
 *
 * The server answers each request for whoever its credentials named when it
 * left: the account the cookies held, or the one a bearer token signs for. A
 * response cannot say which, so every request is tagged when it is sent and
 * its tag is judged against the session this tab accepts. Only an accepted
 * request's answer may be shown.
 *
 * A tag is `{ generation, transport }`. A generation is one session read and
 * the time it is out: the tab opens one for each session read it sends,
 * except that a read joining one already out shares its generation, a retry
 * shares the generation of the read it retries, and an explicit invalidation
 * opens one at once, before its read goes out. The
 * page load's first read is generation 0, and a request the document head
 * sent beside it carries 0 too. Every other request carries the generation
 * open when it is sent, and the transport it went out on (`fetch-transport`).
 *
 * The accepted identity is `{ scope, transport, generations }`: whom the last
 * answer named, over which transport, and every generation whose read named
 * that same identity. A request is then
 *   - accepted ("current"): its generation is one of those, the identity is
 *     confirmed, and it went out over the same transport;
 *   - provisional ("pending"): its generation is the one open now and has not
 *     answered, or the identity is unconfirmed after an invalidation and its
 *     generation may still be confirmed again;
 *   - stale ("stale"), and dropped: anything else. A stale request never
 *     becomes current again.
 *
 * How each session event moves them:
 *   - First answer, or the shell's bootstrap answer taken in its place: the
 *     identity it names is accepted with generation 0.
 *   - Routine re-read (focus, visibility, an expired answer): its generation
 *     is provisional. The accepted identity stays confirmed, so what it
 *     accepted stays shown. An answer naming the same identity adds the
 *     generation, promoting what was sent while it was out. An answer naming
 *     someone else replaces the identity under a fresh generation: what was
 *     accepted before and what was sent while it was out are both stale.
 *   - Retry, after an unreadable answer or a read out past the retry budget:
 *     not an identity event. Nothing accepted changes, and the retry is the
 *     read of the generation the failed one opened, so its answer decides for
 *     what was sent while either was out. A hung read is abandoned and its
 *     late answer is not taken. Before the first answer a retry opens its own
 *     generation instead and replaces the first read, and a hung first read
 *     is replaced at once, as an invalidation.
 *   - Explicit invalidation (a peer tab's broadcast, a 401, a missed
 *     broadcast): a new generation opens and the accepted
 *     identity is unconfirmed, so everything waits. Its read was sent after
 *     the change, so its answer decides for what was sent while it was out:
 *     the same identity adds the generation and every accepted request is
 *     current again; another identity replaces it with this generation.
 *   - Transport change: an embed token arriving or the host runtime swapping
 *     `fetch` dispatches FETCH_TRANSPORT_CHANGED_EVENT, and a request tagged
 *     over a transport other than the accepted one is noticed when tagged.
 *     Either one invalidates explicitly. The read that follows goes out over
 *     the new transport, so its identity differs and replaces the old one.
 *     The session read itself also refuses an answer, or a read in flight,
 *     from another transport.
 *   - Sign-out: an explicit invalidation whose answer names no one.
 *
 * A generation that has not answered always has a read out or scheduled:
 * when the resolver gives up on its budget with one open, it keeps reading in
 * the background, backing off, until one answers.
 */
type AcceptedSessionIdentity = {
  scope: string;
  transport: FetchTransport;
  generations: Set<number>;
};
let acceptedIdentity: AcceptedSessionIdentity | undefined;
let acceptedConfirmed = false;
let sessionGeneration = 0;
// Whether a session read has gone out in the open generation: the next one
// opens another.
let generationRead = false;
// Bumped when a hung read is abandoned, so its late answer is not taken.
let sessionReadAttempt = 0;
let backgroundSessionRead: ReturnType<typeof setTimeout> | undefined;
let backgroundSessionReads = 0;
const sessionReadIdentityListeners = new Set<() => void>();
let sessionInvalidationListenersInstalled = false;
let staleSessionRecheck: ReturnType<typeof setTimeout> | undefined;
let signingOut = false;
const beforeSignOutCleanups = new Set<() => Promise<void>>();

export function registerBeforeSignOutCleanup(
  cleanup: () => Promise<void>,
): () => void {
  beforeSignOutCleanups.add(cleanup);
  return () => beforeSignOutCleanups.delete(cleanup);
}

export function runBeforeSignOutCleanups(): Promise<unknown[]> | undefined {
  if (beforeSignOutCleanups.size === 0) return undefined;
  return Promise.allSettled(
    Array.from(beforeSignOutCleanups, (cleanup) => cleanup()),
  ).then((results) =>
    results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    ),
  );
}

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
  session: ClientAuthSession | null;
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
  | { state: "resolved"; session: ClientAuthSession | null }
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
  recordSessionIdentity(identity);
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
  const before = firstSessionReadAnswer();
  // An explicit invalidation: everything waits for the next answer.
  sessionGeneration += 1;
  generationRead = false;
  acceptedConfirmed = false;
  firstSessionReadUnsent = false;
  cachedSessionFromFirstRead = false;
  firstSessionReadReplaced = true;
  cachedSession = undefined;
  cachedSessionAt = 0;
  cachedEvidence = undefined;
  sessionRequest = undefined;
  sessionRequestTransport = undefined;
  clearTimeout(staleSessionRecheck);
  staleSessionRecheck = undefined;
  if (before !== "replaced") notifyFirstSessionReadAnswer();
  notifySessionReadIdentity();
}

// A read out past the retry budget is given up on without invalidating: what
// is accepted stays accepted, and the next read joins the generation the hung
// one opened, which is still waiting for an answer.
function abandonSessionRead(): void {
  sessionReadAttempt += 1;
  sessionRequest = undefined;
  sessionRequestTransport = undefined;
}

function sessionGenerationAnswered(): boolean {
  return Boolean(
    acceptedConfirmed && acceptedIdentity?.generations.has(sessionGeneration),
  );
}

const BACKGROUND_SESSION_READ_MAX_DELAY_MS = 60_000;

function scheduleBackgroundSessionRead(): void {
  clearTimeout(backgroundSessionRead);
  const delay = Math.min(
    SESSION_RETRY_MAX_DELAY_MS * 2 ** backgroundSessionReads,
    BACKGROUND_SESSION_READ_MAX_DELAY_MS,
  );
  backgroundSessionReads += 1;
  backgroundSessionRead = setTimeout(() => {
    backgroundSessionRead = undefined;
    if (signingOut || activeResolveGeneration !== 0) return;
    void resolveSession();
  }, delay);
}

function notifySessionSubscribers(): Promise<void> {
  if (snapshotListeners.size === 0) {
    // Nobody is showing the last answer, so it is not kept as a hint either.
    resolveGeneration += 1;
    activeResolveGeneration = 0;
    if (snapshot.status !== "signing-out") snapshot = LOADING_SNAPSHOT;
    return Promise.resolve();
  }
  return resolveSession();
}

function invalidateSessionCache(): Promise<void> {
  resetSessionCache();
  invalidateClientStatusRequest(SESSION_STATUS_PATH);
  return notifySessionSubscribers();
}

// A routine re-check: its read opens a provisional generation, and what is
// accepted stays shown while it is out (see "Whom a request was answered
// for").
function rereadSession(): void {
  cachedSessionAt = 0;
  clearTimeout(staleSessionRecheck);
  staleSessionRecheck = undefined;
  expireClientStatusResult(SESSION_STATUS_PATH);
  void notifySessionSubscribers();
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
  // Checked after the change settles: a transport can change while one is
  // being read.
  window.addEventListener(FETCH_TRANSPORT_CHANGED_EVENT, () =>
    queueMicrotask(recheckSessionTransport),
  );
  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_INVALIDATION_STORAGE_KEY) {
      void invalidateSessionCache();
      setTimeout(() => void invalidateSessionCache(), SESSION_CACHE_TTL_MS);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      revalidateStaleSession();
    }
  });
  // A peer tab's broadcast that landed before this listener existed was not
  // heard, but it changed the stored marker. The early session read in the
  // document head, and every read sent beside it, then went out with cookies
  // that may name the account before the change: none of them is this tab's
  // first read any more, and the session is read again.
  if (
    firstSessionReadAnswer() !== "replaced" &&
    bootstrapInvalidationMissed()
  ) {
    void invalidateSessionCache();
  }
}

function bootstrapInvalidationMissed(): boolean {
  const recorded = window[SESSION_BOOTSTRAP_INVALIDATION_GLOBAL];
  return recorded !== undefined && recorded !== readSessionInvalidationMarker();
}

/**
 * Resolves once the session is re-read, so the new identity is in place before
 * callers refetch anything that is scoped by it.
 */
export function notifySessionInvalidated(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  installSessionInvalidationListeners();
  const reread = invalidateSessionCache();
  try {
    window.localStorage.setItem(
      SESSION_INVALIDATION_STORAGE_KEY,
      `${Date.now()}:${Math.random()}`,
    );
  } catch (error) {
    console.warn("Unable to broadcast session invalidation", error);
  }
  return reread;
}

export function isSigningOut(): boolean {
  return signingOut;
}

/**
 * Whether the session this tab holds is the answer to the page load's first
 * session read. A request the load sent before the session was known belongs
 * to the account this session names only while this holds: once a retry or an
 * invalidation answers instead, another tab may have changed the cookies.
 */
export function isSessionFromFirstRead(): boolean {
  return firstSessionReadAnswer() === "first-read";
}

/**
 * Where the page load's first session read stands: `"pending"` until it
 * answers, `"first-read"` while the session this tab holds is its answer, and
 * `"replaced"` once a retry or an invalidation took its place, whether or not
 * it had answered. A request sent before the session was known can be shown
 * only under `"first-read"`; under `"pending"` it waits.
 */
export type FirstSessionReadAnswer = "pending" | "first-read" | "replaced";

export function firstSessionReadAnswer(): FirstSessionReadAnswer {
  if (cachedSession !== undefined && cachedSessionFromFirstRead) {
    return "first-read";
  }
  return firstSessionReadReplaced ? "replaced" : "pending";
}

/**
 * Calls `listener` each time {@link firstSessionReadAnswer} changes, in the
 * same task as the change and before any `useSession` consumer re-renders, so
 * a request made for another account can be dropped before the app is shown.
 */
export function subscribeFirstSessionReadAnswer(
  listener: () => void,
): () => void {
  firstSessionReadAnswerListeners.add(listener);
  return () => {
    firstSessionReadAnswerListeners.delete(listener);
  };
}

function notifyFirstSessionReadAnswer(): void {
  for (const listener of [...firstSessionReadAnswerListeners]) {
    try {
      listener();
    } catch (error) {
      // A listener's failure is its own; the session read still answers.
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

/**
 * Who a request was sent as: the session generation open when it left, and the
 * transport it went out on. See "Whom a request was answered for" above and
 * {@link sessionReadIdentityStatus}.
 */
export type SessionReadIdentity = {
  readonly generation: number;
  readonly transport: FetchTransport;
};

export type SessionReadIdentityStatus = "pending" | "current" | "stale";

function sessionScope(session: AuthSession | null): string {
  return session
    ? JSON.stringify([session.userId ?? session.email, session.orgId ?? null])
    : "signed-out";
}

const NO_FETCH_TRANSPORT = {};

function currentFetchTransport(): FetchTransport {
  return typeof globalThis.fetch === "function"
    ? fetchTransport(globalThis.fetch)
    : NO_FETCH_TRANSPORT;
}

// Whether the session this tab accepts, or the read it has out, was read over
// another transport than requests go out on now.
function sessionTransportChanged(transport: FetchTransport): boolean {
  return Boolean(
    (acceptedConfirmed &&
      acceptedIdentity &&
      acceptedIdentity.transport !== transport) ||
    (sessionRequest && sessionRequestTransport !== transport),
  );
}

function recheckSessionTransport(): void {
  if (sessionTransportChanged(currentFetchTransport())) {
    void invalidateSessionCache();
  }
}

/**
 * The identity a request sent now goes out under: `fetch` is the one it is
 * sent with (the page's own by default). A request the document head sent
 * beside the shell's session read passes `sentWithFirstSessionRead`.
 */
export function sessionReadIdentity(
  options: { fetch?: typeof fetch; sentWithFirstSessionRead?: boolean } = {},
): SessionReadIdentity {
  const transport = options.fetch
    ? fetchTransport(options.fetch)
    : currentFetchTransport();
  // Requests now go out over a transport the session was not read over, and
  // nothing announced it: read the session again over this one.
  if (sessionTransportChanged(currentFetchTransport())) {
    queueMicrotask(recheckSessionTransport);
  }
  return {
    generation: options.sentWithFirstSessionRead ? 0 : sessionGeneration,
    transport,
  };
}

/**
 * Whether a request sent under `identity` was answered for the session this
 * tab accepts now: `"current"` when it was sent as the same person over the
 * same transport, `"stale"` when it was not, or can no longer be known to have
 * been, and `"pending"` while the session read that decides it is out. Only a
 * `"current"` answer may be shown.
 */
export function sessionReadIdentityStatus(
  identity: SessionReadIdentity,
): SessionReadIdentityStatus {
  if (acceptedIdentity?.generations.has(identity.generation)) {
    if (!acceptedConfirmed) return "pending";
    return identity.transport === acceptedIdentity.transport
      ? "current"
      : "stale";
  }
  return identity.generation === sessionGeneration ? "pending" : "stale";
}

/**
 * Calls `listener` each time the session this tab holds changes, in the same
 * task as the change and before any `useSession` consumer re-renders, so a
 * request whose identity has gone stale is dropped before anything shows it.
 */
export function subscribeSessionReadIdentity(listener: () => void): () => void {
  sessionReadIdentityListeners.add(listener);
  return () => {
    sessionReadIdentityListeners.delete(listener);
  };
}

function notifySessionReadIdentity(): void {
  for (const listener of [...sessionReadIdentityListeners]) {
    try {
      listener();
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }
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
  void invalidateSessionCache();
}

export function beginSignOut(): void {
  signingOut = true;
  publishSessionIdentity(null);
  snapshot = { session: null, status: "signing-out", error: null };
  for (const listener of snapshotListeners) listener();
  void invalidateSessionCache();
}

export function completeSignOut(): void {
  notifyParentAuthState("unauthenticated");
  void notifySessionInvalidated();
}

function fetchSharedSession(): Promise<SessionRead> {
  if (signingOut) return Promise.resolve({ state: "resolved", session: null });
  if (agentNativeApiDisabledReason()) {
    return Promise.resolve({ state: "resolved", session: null });
  }
  // The status read takes the shell's answer only over this same transport,
  // so this is the transport the answer was read over either way.
  const transport = currentFetchTransport();
  // An answer read over another transport names whoever that transport's
  // credentials did, not whom this caller's requests go out as: once an embed
  // signs the page's requests with its bearer token they are B's, even while
  // the cookie read said A. Neither that answer nor a read still out on that
  // transport is reused; the session is read again over this one.
  if (sessionTransportChanged(transport)) resetSessionCache();
  if (hasFreshSessionCache()) {
    return Promise.resolve({
      state: "resolved",
      session: cachedSession ?? null,
    });
  }
  if (sessionRequest) return sessionRequest;

  // Each session read opens its own generation; the first in a generation
  // opened by an invalidation, the load's first read, and a retry of a read
  // that never answered once an identity is accepted use the one open.
  if (generationRead && (!acceptedIdentity || sessionGenerationAnswered())) {
    sessionGeneration += 1;
    notifySessionReadIdentity();
  }
  generationRead = true;
  const requestGeneration = sessionGeneration;
  const requestAttempt = sessionReadAttempt;
  const firstRead = firstSessionReadUnsent;
  firstSessionReadUnsent = false;
  let request: Promise<SessionRead>;
  const requestResult = (async (): Promise<SessionRead> => {
    try {
      const result = await fetchAuthSessionStatus();
      if (
        requestGeneration !== sessionGeneration ||
        requestAttempt !== sessionReadAttempt
      ) {
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
          : (data as AuthSessionResponse & ClientAuthSession);
      const answerBefore = firstSessionReadAnswer();
      const scope = sessionScope(session);
      const sameIdentity =
        acceptedIdentity?.scope === scope &&
        acceptedIdentity.transport === transport;
      // A routine re-check that names the identity already accepted keeps
      // whatever was accepted, the first read's answer included.
      const confirmsAccepted = sameIdentity && acceptedConfirmed;
      if (acceptedIdentity && sameIdentity) {
        acceptedIdentity.generations.add(requestGeneration);
      } else {
        if (acceptedConfirmed) {
          // A routine re-check found someone else. What was sent while it was
          // out went with cookies that may name either, so it is dropped
          // with what was accepted before; the new identity starts afresh.
          sessionGeneration += 1;
        }
        acceptedIdentity = {
          scope,
          transport,
          generations: new Set([sessionGeneration]),
        };
      }
      acceptedConfirmed = true;
      cachedSession = session;
      if (!confirmsAccepted) {
        cachedSessionFromFirstRead = firstRead;
        if (!firstRead) firstSessionReadReplaced = true;
      }
      cachedSessionAt = statusResultAnsweredAt(result) ?? Date.now();
      cachedEvidence = session
        ? "signed_in"
        : result.state === "unavailable"
          ? "http_401"
          : "signed_out_body";
      publishSessionIdentity(session);
      if (firstSessionReadAnswer() !== answerBefore) {
        notifyFirstSessionReadAnswer();
      }
      notifySessionReadIdentity();
      return { state: "resolved", session };
    } catch {
      return { state: "unreadable" };
    }
  })();
  request = requestResult.finally(() => {
    if (sessionRequest === request) sessionRequest = undefined;
  });

  sessionRequest = request;
  sessionRequestTransport = transport;

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
  clearTimeout(backgroundSessionRead);
  backgroundSessionRead = undefined;
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
        if (acceptedIdentity) abandonSessionRead();
        else resetSessionCache();
        invalidateClientStatusRequest(SESSION_STATUS_PATH);
        hung = true;
        read = { state: "unreadable" };
      } else {
        read = raced;
      }

      if (read.state === "resolved") {
        backgroundSessionReads = 0;
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
        } else if (isDefinitive(snapshot) && !sessionGenerationAnswered()) {
          // The page is shown and a generation is still waiting: requests
          // sent in it stay pending until a read answers it.
          scheduleBackgroundSessionRead();
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
