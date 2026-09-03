import {
  AGENT_ACCESS_PARAM,
  scopedAgentAccessResourceId,
} from "@agent-native/core/shared";

export const SESSION_REPLAY_AGENT_ACCESS_PARAM =
  AGENT_ACCESS_PARAM || "agent_access";
export const SESSION_REPLAY_AGENT_ACCESS_TOKEN_PREFIX =
  "analytics-session-replay-agent-context";

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
