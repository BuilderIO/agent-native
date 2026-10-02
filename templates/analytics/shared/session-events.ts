import { z } from "zod";

/** rrweb custom-event tag the core recorder uses for tracked app events. */
export const SESSION_REPLAY_ANALYTICS_EVENT_TAG = "agent-native.event";

/** Sessions URL params for did/didn't event conditions (repeatable). */
export const SESSION_DID_EVENT_PARAM = "event";
export const SESSION_DID_NOT_EVENT_PARAM = "noEvent";
export const MAX_SESSION_EVENT_CONDITIONS = 5;

/**
 * Events the framework sends without app code. An app that sends only these
 * has not named any of its own events yet.
 */
export const AUTOMATIC_ANALYTICS_EVENT_NAMES: ReadonlySet<string> = new Set([
  "pageview",
  "session status",
  "session_status",
  "action_started",
  "action_completed",
  "action_failed",
  "action.response",
  "web_vitals",
  "http.response",
  "$exception",
  "$ai_generation",
  "$ai_feedback",
  "agent_chat_lifecycle",
  "session_replay_started",
  "session replay upload rejected",
  "session_replay_upload_rejected",
  "app_entered",
  "core_action_started",
  "core_action_completed",
  "core_action_failed",
  "output_viewed",
  "output_shared",
  "return_usage",
  "cross_app_used",
]);

export interface SessionEventNameCount {
  eventName: string;
  sessionCount: number;
}

export interface EventCatalogEntry {
  eventName: string;
  app: string | null;
  volume: number;
  lastSeenAt: string;
  propertyKeys: string[];
  description: string | null;
  automatic: boolean;
  stoppedFiring: boolean;
}

export interface EventCatalogApp {
  app: string | null;
  eventCount: number;
  volume: number;
  onlyAutomaticEvents: boolean;
}

export interface EventCatalogResult {
  from: string;
  to: string;
  entries: EventCatalogEntry[];
  apps: EventCatalogApp[];
  /** More events exist than the catalog returns; the most recently seen win. */
  truncated: boolean;
}

/**
 * A range bound for event actions: an ISO date or an ISO timestamp with an
 * offset. `new Date()` would accept "Sept 1" as 2001 and roll Feb 30 forward.
 */
export const sessionEventBoundSchema = z.union([
  z.iso.date(),
  z.iso.datetime({ offset: true }),
]);

/** Data Dictionary entries describe an event when their name matches it. */
export function eventDescriptionKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "_");
}

function readEventNames(params: URLSearchParams, key: string): string[] {
  return [
    ...new Set(
      params
        .getAll(key)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_SESSION_EVENT_CONDITIONS);
}

export function readSessionEventFilters(params: URLSearchParams): {
  didEvents: string[];
  didNotEvents: string[];
} {
  return {
    didEvents: readEventNames(params, SESSION_DID_EVENT_PARAM),
    didNotEvents: readEventNames(params, SESSION_DID_NOT_EVENT_PARAM),
  };
}

/** Sessions URL showing sessions that contain an event. */
export function sessionsWithEventPath(
  eventName: string,
  options: { app?: string | null; range?: string | null } = {},
): string {
  const params = new URLSearchParams();
  params.append(SESSION_DID_EVENT_PARAM, eventName);
  if (options.app) params.set("app", options.app);
  if (options.range) params.set("range", options.range);
  return `/sessions?${params.toString()}`;
}
