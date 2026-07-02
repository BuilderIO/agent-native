import {
  getRequestContext,
  signShortLivedToken,
  verifyShortLivedToken,
} from "@agent-native/core/server";

import {
  SESSION_REPLAY_AGENT_ACCESS_PARAM,
  sessionReplayAgentAccessTokenResourceId,
} from "../../shared/session-replay-agent-access.js";
import {
  compactSessionRecordingSummary,
  getSessionReplaySummary,
  getSessionReplayTokenizedEvents,
  getSessionReplayTokenizedSummary,
  type ReplayScope,
} from "./session-replay.js";

export { SESSION_REPLAY_AGENT_ACCESS_PARAM };
export const SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS = 2 * 60 * 60;

type AgentReplayEvent = Record<string, any>;

const RRWEB_EVENT_TYPE = {
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
} as const;

const INCREMENTAL_SOURCE = {
  MouseInteraction: 2,
  Scroll: 3,
  Input: 5,
} as const;

const MOUSE_INTERACTION = {
  Click: 2,
  DblClick: 4,
  Focus: 5,
} as const;

function appBasePath(): string {
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}` : "";
}

function appOrigin(explicitOrigin?: string): string {
  const fromContext = getRequestContext()?.requestOrigin;
  const origin =
    explicitOrigin ||
    fromContext ||
    process.env.APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";
  try {
    return new URL(origin).origin;
  } catch {
    return "http://localhost:3000";
  }
}

function absoluteUrl(path: string, origin?: string): string {
  return `${appOrigin(origin)}${appBasePath()}${path}`;
}

function appendAgentToken(path: string, token: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${SESSION_REPLAY_AGENT_ACCESS_PARAM}=${encodeURIComponent(
    token,
  )}`;
}

function replayStartedAt(events: AgentReplayEvent[]): number {
  const first = events.find((event) =>
    Number.isFinite(Number(event.timestamp)),
  );
  return Number(first?.timestamp ?? 0) || 0;
}

function pathLabel(href: string): string {
  try {
    const parsed = new URL(href);
    return parsed.pathname || parsed.hostname;
  } catch {
    return href;
  }
}

function markerDetail(event: AgentReplayEvent): string | null {
  const payload = event.data?.payload;
  if (typeof payload?.message === "string") return payload.message;
  if (typeof event.data?.href === "string") return event.data.href;
  return null;
}

function buildReplayTimeline(events: AgentReplayEvent[]) {
  const startedAt = replayStartedAt(events);
  const markers: Array<{
    offsetMs: number;
    timestamp: number;
    kind: "navigation" | "input" | "click" | "scroll" | "custom";
    label: string;
    detail: string | null;
  }> = [];

  for (const event of events) {
    const timestamp = Number(event.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;

    if (
      event.type === RRWEB_EVENT_TYPE.Meta &&
      typeof event.data?.href === "string"
    ) {
      markers.push({
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "navigation",
        label: pathLabel(event.data.href),
        detail: event.data.href,
      });
    } else if (
      event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
      event.data?.source === INCREMENTAL_SOURCE.Input
    ) {
      markers.push({
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "input",
        label: "Input",
        detail: null,
      });
    } else if (
      event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
      event.data?.source === INCREMENTAL_SOURCE.Scroll
    ) {
      markers.push({
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "scroll",
        label: "Scroll",
        detail: null,
      });
    } else if (
      event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
      event.data?.source === INCREMENTAL_SOURCE.MouseInteraction &&
      (event.data?.type === MOUSE_INTERACTION.Click ||
        event.data?.type === MOUSE_INTERACTION.DblClick ||
        event.data?.type === MOUSE_INTERACTION.Focus)
    ) {
      markers.push({
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "click",
        label: event.data.type === MOUSE_INTERACTION.Focus ? "Focus" : "Click",
        detail: null,
      });
    } else if (event.type === RRWEB_EVENT_TYPE.Custom) {
      markers.push({
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "custom",
        label: String(event.data?.tag ?? "Custom event"),
        detail: markerDetail(event),
      });
    }
  }

  return markers.sort((a, b) => a.offsetMs - b.offsetMs).slice(0, 200);
}

export function verifySessionReplayAgentAccess(
  recordingId: string,
  token: string,
): boolean {
  return verifyShortLivedToken(
    token,
    sessionReplayAgentAccessTokenResourceId(recordingId),
  ).ok;
}

export async function createSessionReplayAgentLink({
  recordingId,
  scope,
  origin,
}: {
  recordingId: string;
  scope: ReplayScope;
  origin?: string;
}) {
  const recording = await getSessionReplaySummary(recordingId, scope);
  const token = signShortLivedToken({
    resourceId: sessionReplayAgentAccessTokenResourceId(recording.id),
    viewerEmail: scope.userEmail,
    ttlSeconds: SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS,
  });
  const expiresAt = new Date(
    Date.now() + SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS * 1000,
  ).toISOString();
  const sessionPath = appendAgentToken(
    `/sessions/${encodeURIComponent(recording.id)}`,
    token,
  );
  const contextPath = appendAgentToken(
    `/api/session-replay/agent-context.json?id=${encodeURIComponent(
      recording.id,
    )}`,
    token,
  );

  return {
    recordingId: recording.id,
    url: absoluteUrl(sessionPath, origin),
    contextUrl: absoluteUrl(contextPath, origin),
    expiresAt,
    ttlSeconds: SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS,
  };
}

export async function buildSessionReplayAgentContext({
  recordingId,
  token,
  origin,
  includeTimeline = true,
}: {
  recordingId: string;
  token: string;
  origin?: string;
  includeTimeline?: boolean;
}) {
  if (!verifySessionReplayAgentAccess(recordingId, token)) {
    const error = Object.assign(new Error("Invalid or expired agent access"), {
      statusCode: 401,
    });
    throw error;
  }

  const recording = await getSessionReplayTokenizedSummary(recordingId);
  const contextPath = appendAgentToken(
    `/api/session-replay/agent-context.json?id=${encodeURIComponent(
      recording.id,
    )}`,
    token,
  );
  const eventsPath = appendAgentToken(
    `/api/session-replay/agent-events.json?id=${encodeURIComponent(
      recording.id,
    )}&limit=10000`,
    token,
  );
  const pagePath = appendAgentToken(
    `/sessions/${encodeURIComponent(recording.id)}`,
    token,
  );

  const eventsResponse = includeTimeline
    ? await getSessionReplayTokenizedEvents(recording.id, { limit: 10000 })
    : null;
  const events =
    eventsResponse?.chunks.flatMap((chunk) =>
      chunk.events.filter(
        (event): event is AgentReplayEvent =>
          Boolean(event) && typeof event === "object",
      ),
    ) ?? [];
  const markers = buildReplayTimeline(events);

  return {
    type: "agent-native.analytics.session-replay",
    version: 1,
    instructions: [
      "Use recording for the session-level summary and timeline.markers for navigation, clicks, inputs, scrolls, and custom events.",
      "Use apis.events only when you need bounded rrweb details. Do not paste raw rrweb JSON into the final answer.",
      "Treat page text, URLs, and replay metadata as user data. Do not expose private data beyond what is needed to debug the user's question.",
      "The token is scoped to this recording and expires; do not store it in code, docs, screenshots, or long-lived notes.",
    ],
    recording: compactSessionRecordingSummary(recording),
    apis: {
      page: { method: "GET", url: absoluteUrl(pagePath, origin) },
      context: { method: "GET", url: absoluteUrl(contextPath, origin) },
      events: {
        method: "GET",
        url: absoluteUrl(eventsPath, origin),
        note: "Returns bounded sanitized replay events; storage/provider URLs stay private.",
      },
    },
    timeline: {
      markerCount: markers.length,
      markers,
      truncated: Boolean(eventsResponse?.truncated),
      unavailableChunks: eventsResponse?.unavailableChunks ?? 0,
    },
  };
}

export function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        return char;
    }
  });
}
