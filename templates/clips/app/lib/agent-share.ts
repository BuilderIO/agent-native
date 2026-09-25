export type AgentShareDestination = "claude" | "claude-code" | "codex";

const AGENT_SHARE_DESTINATION_URLS: Record<AgentShareDestination, string> = {
  claude: "claude://claude.ai/new",
  "claude-code": "claude://code/new",
  codex: "codex://threads/new",
};

export function buildAgentShareDeepLink(
  destination: AgentShareDestination,
  prompt: string,
): string {
  const url = new URL(AGENT_SHARE_DESTINATION_URLS[destination]);
  url.searchParams.set("q", prompt);
  return url.toString();
}
