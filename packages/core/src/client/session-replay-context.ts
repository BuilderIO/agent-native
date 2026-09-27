import { getOrCreateAnalyticsSessionId } from "./analytics-session.js";

export interface SessionReplayContext {
  replayId: string;
  sessionId: string;
  startedAtMs: number;
  startedAt: string;
  linkBaseUrl: string | null;
  active: boolean;
}

export interface SessionReplayLinkOptions {
  at?: Date | number | string;
  linkBaseUrl?: string;
}

type StoredReplaySession = {
  sessionId?: string;
  replayId?: string;
  startedAtMs?: number;
  linkBaseUrl?: string;
};

type SessionReplayState = {
  active?: boolean;
  replayId?: string | null;
  startedAtMs?: number | null;
  replayLinkBaseUrl?: string | null;
};

const SESSION_REPLAY_STATE_KEY = Symbol.for(
  "agent-native.client.sessionReplay",
);
const SESSION_REPLAY_ID_STORAGE_KEY = "agent-native.session_replay_id";

function readStoredReplaySession(): StoredReplaySession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_REPLAY_ID_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredReplaySession;
    return parsed && typeof parsed === "object" ? parsed : null;
    // coercion-ok: disabled session storage means replay context is absent
  } catch {
    return null;
  }
}

function getLiveReplayState(): SessionReplayState | null {
  if (typeof window === "undefined") return null;
  const state = (
    globalThis as typeof globalThis & {
      [SESSION_REPLAY_STATE_KEY]?: SessionReplayState;
    }
  )[SESSION_REPLAY_STATE_KEY];
  return state ?? null;
}

export function getSessionReplayContext(): SessionReplayContext | null {
  const state = getLiveReplayState();
  if (state?.active && state.replayId && state.startedAtMs) {
    const sessionId = getOrCreateAnalyticsSessionId();
    if (!sessionId) return null;
    return {
      replayId: state.replayId,
      sessionId,
      startedAtMs: state.startedAtMs,
      startedAt: new Date(state.startedAtMs).toISOString(),
      linkBaseUrl: state.replayLinkBaseUrl ?? null,
      active: true,
    };
  }

  const stored = readStoredReplaySession();
  if (!stored?.replayId || !stored.sessionId || !stored.startedAtMs) {
    return null;
  }
  return {
    replayId: stored.replayId,
    sessionId: stored.sessionId,
    startedAtMs: stored.startedAtMs,
    startedAt: new Date(stored.startedAtMs).toISOString(),
    linkBaseUrl: stored.linkBaseUrl ?? null,
    active: false,
  };
}

function normalizeReplayLinkBaseUrl(value?: string): string | null {
  const raw =
    value?.trim() ||
    (import.meta.env as Record<string, string | undefined>)[
      "VITE_AGENT_NATIVE_ANALYTICS_APP_URL"
    ]?.trim() ||
    (typeof window !== "undefined" ? window.location.origin : "");
  if (!raw) return null;
  try {
    return new URL(
      raw,
      typeof window !== "undefined" ? window.location.href : undefined,
    ).origin;
    // coercion-ok: an invalid configured origin means no replay link is available
  } catch {
    return null;
  }
}

export function getSessionReplayUrl(
  options: SessionReplayLinkOptions = {},
): string | null {
  const context = getSessionReplayContext();
  if (!context) return null;
  const base = normalizeReplayLinkBaseUrl(
    options.linkBaseUrl ?? context.linkBaseUrl ?? undefined,
  );
  if (!base) return null;

  try {
    const url = new URL("/sessions/lookup", base);
    url.searchParams.set("sessionId", context.sessionId);
    url.searchParams.set("replayId", context.replayId);
    const at = options.at === undefined ? Date.now() : options.at;
    const timestamp =
      typeof at === "number"
        ? new Date(at)
        : typeof at === "string"
          ? new Date(at)
          : at;
    if (!Number.isNaN(timestamp.getTime())) {
      url.searchParams.set("at", timestamp.toISOString());
    }
    return url.toString();
    // coercion-ok: invalid link inputs produce no replay URL
  } catch {
    return null;
  }
}
