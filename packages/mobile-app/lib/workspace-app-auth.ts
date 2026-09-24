import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { callAppAction, callAppActionGet } from "./agent-chat/api";

const dispatchApp = TEMPLATE_APPS.find((app) => app.id === "dispatch");
export const MOBILE_DISPATCH_BASE_URL =
  dispatchApp?.url ?? "https://dispatch.agent-native.com";

export const DISPATCH_WORKSPACE_SSO_FLAG_KEY = "dispatch.workspace-sso";

export interface WorkspaceAppEmbedSession {
  startUrl: string;
  targetPath?: string;
  expiresAt?: number;
  app: string;
}

/**
 * Read the per-user rollout gate before asking Dispatch to mint a target
 * session. A disabled rollout leaves the child app's own login surface intact;
 * it never falls back to putting the parent bearer in a URL.
 */
export async function isWorkspaceSsoEnabled(
  baseUrl = MOBILE_DISPATCH_BASE_URL,
): Promise<boolean> {
  const flags = await callAppActionGet<Record<string, unknown>>(
    "get-feature-flags",
    {},
    baseUrl,
  );
  return flags[DISPATCH_WORKSPACE_SSO_FLAG_KEY] === true;
}

/**
 * Exchange the signed-in mobile parent session for a one-time target-app
 * session. The bearer never crosses into the child WebView; only the short-
 * lived, app-scoped start URL is loaded there.
 */
export async function createWorkspaceAppEmbedSession({
  app,
  path,
  baseUrl = MOBILE_DISPATCH_BASE_URL,
}: {
  app: string;
  path?: string;
  baseUrl?: string;
}): Promise<WorkspaceAppEmbedSession> {
  const result = await callAppAction<WorkspaceAppEmbedSession>(
    "create-workspace-app-embed-session",
    {
      app,
      ...(path ? { path } : {}),
      chrome: "minimal",
    },
    baseUrl,
  );
  if (!result || typeof result.startUrl !== "string" || !result.startUrl) {
    throw new Error("Dispatch did not return a workspace app session.");
  }
  try {
    const parsed = new URL(result.startUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Dispatch returned an invalid workspace app session.");
    }
    if (!parsed.pathname.endsWith("/_agent-native/embed/start")) {
      throw new Error("Dispatch returned an invalid workspace app session.");
    }
    const queryKeys = [...new Set([...parsed.searchParams.keys()])];
    if (
      queryKeys.length !== 1 ||
      queryKeys[0] !== "ticket" ||
      !parsed.searchParams.get("ticket")
    ) {
      throw new Error("Dispatch returned an invalid workspace app session.");
    }
    if (parsed.username || parsed.password || parsed.hash) {
      throw new Error("Dispatch returned an invalid workspace app session.");
    }
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("Dispatch returned an invalid workspace app session.");
  }
  return result;
}

/**
 * A workspace app open costs four serial round trips to Dispatch before the
 * target host is contacted at all, and `/_agent-native/embed/start` is the
 * only hop that is `no-store` AND gated behind the target app's full plugin
 * bootstrap — measured at 4.5s on a cold function against 25ms for the same
 * app's CDN-cached shell. The two caches below exist to keep that hop off the
 * critical path of every open, not just to save bytes.
 */

const SSO_FLAG_TTL_MS = 10 * 60 * 1000;
let ssoFlagCache: {
  owner: string;
  readAt: number;
  value: boolean;
} | null = null;
const ssoFlagInFlight = new Map<string, Promise<boolean>>();

/**
 * Reuse a minted embed session for less than the embed cookie's own lifetime
 * (`maxAge: 3600` server-side) so a reused session is never a guess about
 * whether the credential is still live.
 */
const EMBED_SESSION_REUSE_MS = 55 * 60 * 1000;
const LIVE_EMBED_SESSIONS_KEY = "agent-native:live-workspace-app-sessions-v2";
/**
 * Keyed by app, NOT by app+owner. The React Native cookie jar is shared per
 * origin, so only one account can hold a live session for an app at a time —
 * signing in as B overwrites A's child cookie in place. A per-owner map let
 * A → B → A reuse A's stale marker against B's cookie and show one account the
 * other's data, so the map has to mirror what the jar can actually hold.
 */
const liveEmbedSessions = new Map<
  string,
  { establishedAt: number; owner: string }
>();
let hydration: Promise<void> | null = null;

function persistLiveEmbedSessions(): void {
  const entries: Record<string, { establishedAt: number; owner: string }> = {};
  for (const [key, value] of liveEmbedSessions) {
    entries[key] = value;
  }
  void AsyncStorage.setItem(
    LIVE_EMBED_SESSIONS_KEY,
    JSON.stringify(entries),
  ).catch(() => {
    // A failed write only costs the next open one extra handshake.
  });
}

/**
 * WebView cookies outlive the JS process, so a relaunch inside the embed
 * cookie's hour can still open at the CDN-cached shell. React Native gives no
 * way to read those cookies back, so the marker is persisted alongside them —
 * and `handleLoadEnd` re-mints if the app answers with its sign-in document,
 * which is what keeps a wrong marker self-correcting rather than silent.
 */
export function ensureLiveWorkspaceAppSessionsHydrated(): Promise<void> {
  if (hydration) return hydration;
  hydration = AsyncStorage.getItem(LIVE_EMBED_SESSIONS_KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return;
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== "object") continue;
        const { establishedAt, owner } = value as Record<string, unknown>;
        if (typeof establishedAt !== "number" || typeof owner !== "string") {
          continue;
        }
        if (liveEmbedSessions.has(key)) continue;
        liveEmbedSessions.set(key, { establishedAt, owner });
      }
    })
    .catch(() => {
      // Unreadable storage means "nothing remembered", which costs a
      // handshake — never a wrongly reused session.
    });
  return hydration;
}

/**
 * Fingerprint, not the credential. Every cache here is scoped to the signed-in
 * parent session so an account switch cannot inherit the previous user's
 * rollout decision or reuse their session, and none of them may hold a bearer.
 */
export function mobileSessionFingerprint(parentSessionToken: string): string {
  return sessionFingerprint(parentSessionToken);
}

function sessionFingerprint(parentSessionToken: string): string {
  let hash = 0;
  for (let index = 0; index < parentSessionToken.length; index += 1) {
    hash = (hash * 31 + parentSessionToken.charCodeAt(index)) | 0;
  }
  return String(hash);
}

/** Record that `app` now holds a live embed session in the shared cookie store. */
export function rememberLiveWorkspaceAppSession(
  app: string,
  parentSessionToken: string,
  establishedAt = Date.now(),
): void {
  // Overwrites whatever another account had recorded for this app, exactly as
  // establishing the session overwrote their cookie in the shared jar.
  liveEmbedSessions.set(app, {
    establishedAt,
    owner: sessionFingerprint(parentSessionToken),
  });
  persistLiveEmbedSessions();
}

/** Forget a session the target app rejected, so the next open re-mints. */
export function forgetLiveWorkspaceAppSession(
  app: string,
  parentSessionToken: string,
): void {
  const entry = liveEmbedSessions.get(app);
  if (!entry || entry.owner !== sessionFingerprint(parentSessionToken)) return;
  liveEmbedSessions.delete(app);
  persistLiveEmbedSessions();
}

/**
 * True when `app` can be opened at its ordinary URL — the CDN-cached shell —
 * because a still-live embed session already sits in the shared cookie store.
 */
export function hasLiveWorkspaceAppSession(
  app: string,
  parentSessionToken: string,
  now = Date.now(),
): boolean {
  const entry = liveEmbedSessions.get(app);
  if (!entry) return false;
  // A marker another account established says nothing about this one — the
  // cookie in the jar belongs to them, not to the caller.
  if (entry.owner !== sessionFingerprint(parentSessionToken)) return false;
  if (now - entry.establishedAt >= EMBED_SESSION_REUSE_MS) {
    liveEmbedSessions.delete(app);
    return false;
  }
  return true;
}

/** Drop every remembered session — native sign-out and test isolation. */
export function clearLiveWorkspaceAppSessions(): void {
  liveEmbedSessions.clear();
  hydration = null;
  ssoFlagCache = null;
  ssoFlagInFlight.clear();
  void AsyncStorage.removeItem(LIVE_EMBED_SESSIONS_KEY).catch(() => {});
}

/**
 * The cached rollout answer, or `null` when it has never been read in this
 * window. `null` means unknown, never "disabled" — a caller must be able to
 * tell those apart before deciding to skip work on a user's behalf.
 */
export function peekWorkspaceSsoEnabled(
  parentSessionToken: string,
  now = Date.now(),
): boolean | null {
  const owner = sessionFingerprint(parentSessionToken);
  if (!ssoFlagCache || ssoFlagCache.owner !== owner) return null;
  return now - ssoFlagCache.readAt < SSO_FLAG_TTL_MS
    ? ssoFlagCache.value
    : null;
}

/**
 * Rollout gate, read once per process window instead of once per app open.
 * Only a successful read is cached: a failure must stay distinguishable from
 * a disabled rollout, or every app silently falls back to its own login form.
 */
export async function readWorkspaceSsoEnabled(
  parentSessionToken: string,
  baseUrl = MOBILE_DISPATCH_BASE_URL,
  now = Date.now(),
): Promise<boolean> {
  const cached = peekWorkspaceSsoEnabled(parentSessionToken, now);
  if (cached !== null) return cached;
  // Keyed by owner as well: an account switch while a read is in flight must
  // not hand the new user the previous user's answer.
  const owner = sessionFingerprint(parentSessionToken);
  const pending = ssoFlagInFlight.get(owner);
  if (pending) return pending;
  const request = isWorkspaceSsoEnabled(baseUrl)
    .then((value) => {
      ssoFlagCache = { owner, readAt: now, value };
      return value;
    })
    .finally(() => {
      ssoFlagInFlight.delete(owner);
    });
  ssoFlagInFlight.set(owner, request);
  return request;
}
