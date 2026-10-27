export type ReviewAgentKind = "claude" | "claude-code" | "codex" | "agent";

export interface ReviewAgentIdentity {
  kind: ReviewAgentKind;
  label: string;
}

/** Returns null unless createdBy === "agent". */
export function resolveReviewAgent(input: {
  createdBy?: string | null;
  authorName?: string | null;
}): ReviewAgentIdentity | null {
  if (input.createdBy !== "agent") return null;
  const authorName = input.authorName?.trim() || null;
  return {
    kind: agentKindFromName(authorName ?? ""),
    label: authorName ?? "Agent",
  };
}

function agentKindFromName(authorName: string): ReviewAgentKind {
  const name = authorName.toLowerCase();
  if (name.includes("claude code") || name.includes("claude-code")) {
    return "claude-code";
  }
  if (name.includes("claude")) return "claude";
  if (name.includes("codex") || name.includes("openai")) return "codex";
  return "agent";
}
