import {
  AGENT_ACCESS_PARAM,
  scopedAgentAccessResourceId,
} from "@agent-native/core/shared";

export const SESSION_REPLAY_AGENT_ACCESS_PARAM =
  AGENT_ACCESS_PARAM || "agent_access";
export const SESSION_REPLAY_AGENT_ACCESS_TOKEN_PREFIX =
  "analytics-session-replay-agent-context";
/** Opens a session page at this many milliseconds after the recording's start. */
export const SESSION_REPLAY_AT_MS_PARAM = "atMs";

export const SESSION_REPLAY_AGENT_CONTEXT_ENDPOINT =
  "/api/session-replay/agent-context.json";
export const SESSION_REPLAY_AGENT_EVENTS_ENDPOINT =
  "/api/session-replay/agent-events.json";
export const SESSION_REPLAY_AGENT_DIAGNOSTICS_ENDPOINT =
  "/api/session-replay/agent-diagnostics.json";

export function sessionReplayAgentAccessTokenResourceId(
  recordingId: string,
): string {
  if (typeof scopedAgentAccessResourceId !== "function") {
    return `${SESSION_REPLAY_AGENT_ACCESS_TOKEN_PREFIX}:${recordingId}`;
  }
  return scopedAgentAccessResourceId(
    SESSION_REPLAY_AGENT_ACCESS_TOKEN_PREFIX,
    recordingId,
  );
}
