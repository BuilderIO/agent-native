import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { type SessionReplayConsoleLevel } from "../../../../shared/session-replay-diagnostics.js";
import {
  buildSessionReplayDiagnostics,
  SESSION_REPLAY_AGENT_ACCESS_PARAM,
  verifySessionReplayAgentAccess,
} from "../../../lib/session-replay-agent-context.js";
import { getSessionReplayTokenizedEvents } from "../../../lib/session-replay.js";

const DEFAULT_DIAGNOSTICS_LIMIT = 200;
const MAX_DIAGNOSTICS_LIMIT = 500;
const DEFAULT_REPLAY_EVENT_READ_LIMIT = 10_000;
const MAX_REPLAY_EVENT_READ_LIMIT = 100_000;
const CONSOLE_LEVELS = new Set(["log", "info", "warn", "error", "debug"]);

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function queryInt(value: unknown): number | undefined {
  const raw = queryString(value);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

function applyAgentJsonHeaders(event: any) {
  setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
}

export default defineEventHandler(async (event) => {
  applyAgentJsonHeaders(event);
  const query = getQuery(event);
  const id = queryString(query.id);
  const token = queryString(query[SESSION_REPLAY_AGENT_ACCESS_PARAM]);

  if (!id || !token) {
    setResponseStatus(event, 400);
    return { error: "id and agent access token are required" };
  }
  if (!verifySessionReplayAgentAccess(id, token)) {
    setResponseStatus(event, 401);
    return { error: "Invalid or expired agent access" };
  }

  const kind = queryString(query.kind) || "all";
  if (kind !== "console" && kind !== "network" && kind !== "all") {
    setResponseStatus(event, 400);
    return { error: "kind must be console, network, or all" };
  }
  const rawLevel = queryString(query.level);
  if (rawLevel && !CONSOLE_LEVELS.has(rawLevel)) {
    setResponseStatus(event, 400);
    return { error: "level must be log, info, warn, error, or debug" };
  }
  const level = (rawLevel || undefined) as
    | SessionReplayConsoleLevel
    | undefined;
  const limit = Math.min(
    MAX_DIAGNOSTICS_LIMIT,
    Math.max(1, queryInt(query.limit) ?? DEFAULT_DIAGNOSTICS_LIMIT),
  );

  const rawOffset = queryString(query.offset);
  if (rawOffset && queryInt(query.offset) === undefined) {
    setResponseStatus(event, 400);
    return { error: "offset must be a non-negative integer" };
  }
  const offset = Math.max(0, queryInt(query.offset) ?? 0);

  const rawFromMs = queryString(query.fromMs);
  if (rawFromMs && queryInt(query.fromMs) === undefined) {
    setResponseStatus(event, 400);
    return { error: "fromMs must be a non-negative integer" };
  }
  const fromMs = queryInt(query.fromMs);

  const rawToMs = queryString(query.toMs);
  if (rawToMs && queryInt(query.toMs) === undefined) {
    setResponseStatus(event, 400);
    return { error: "toMs must be a non-negative integer" };
  }
  const toMs = queryInt(query.toMs);

  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
    setResponseStatus(event, 400);
    return { error: "fromMs must be less than or equal to toMs" };
  }

  try {
    const timeWindowed = fromMs !== undefined || toMs !== undefined;
    const replayEventReadLimit = Math.min(
      MAX_REPLAY_EVENT_READ_LIMIT,
      Math.max(
        DEFAULT_REPLAY_EVENT_READ_LIMIT,
        timeWindowed
          ? MAX_REPLAY_EVENT_READ_LIMIT
          : (rawOffset ? offset : 0) + limit,
      ),
    );
    const eventsResponse = await getSessionReplayTokenizedEvents(id, {
      limit: replayEventReadLimit,
    });
    const events = eventsResponse.chunks.flatMap((chunk) =>
      chunk.events.filter(
        (item): item is Record<string, any> =>
          Boolean(item) && typeof item === "object",
      ),
    );
    const diagnostics = buildSessionReplayDiagnostics(events, {
      maxConsoleEntries: kind === "network" ? 0 : limit,
      maxNetworkEntries: kind === "console" ? 0 : limit,
      consoleLevel: level,
      ...(rawOffset ? { offset } : {}),
      ...(fromMs !== undefined ? { fromMs } : {}),
      ...(toMs !== undefined ? { toMs } : {}),
    });
    return {
      recordingId: eventsResponse.recording.id,
      kind,
      ...(level ? { level } : {}),
      limit,
      ...(rawOffset ? { offset } : {}),
      ...(fromMs !== undefined ? { fromMs } : {}),
      ...(toMs !== undefined ? { toMs } : {}),
      ...(kind !== "network" ? { console: diagnostics.console } : {}),
      ...(kind !== "console" ? { network: diagnostics.network } : {}),
      eventsTruncated: eventsResponse.truncated,
      unavailableChunks: eventsResponse.unavailableChunks,
    };
  } catch (error: any) {
    setResponseStatus(event, error?.statusCode ?? 400);
    return { error: error?.message || String(error) };
  }
});
