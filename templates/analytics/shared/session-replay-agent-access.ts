export const SESSION_REPLAY_AGENT_ACCESS_PARAM = "agent_access";

const SESSION_REPLAY_AGENT_ACCESS_TOKEN_PREFIX =
  "analytics-session-replay-agent-context";

export function sessionReplayAgentAccessTokenResourceId(
  recordingId: string,
): string {
  return `${SESSION_REPLAY_AGENT_ACCESS_TOKEN_PREFIX}:${recordingId}`;
}
