/** What agents may do on a page, from least to most. */
export const AGENT_LEVELS = ["view", "comment", "edit"] as const;

export type AgentLevel = (typeof AGENT_LEVELS)[number];

/**
 * documents.agent_text_locked holds the level: 0 Can edit, 1 Can comment, 2
 * Can view. Any level but Can edit keeps agents out of the text, so code that
 * only asks "is the text locked" reads the column as a boolean.
 */
const STORED_AGENT_LEVELS: Record<AgentLevel, number> = {
  edit: 0,
  comment: 1,
  view: 2,
};

export function storedAgentLevel(level: AgentLevel): number {
  return STORED_AGENT_LEVELS[level];
}

/** A value this code doesn't know reads as Can view, the narrowest level. */
export function agentLevelFromStored(
  stored: number | null | undefined,
): AgentLevel {
  if (!stored) return "edit";
  return stored === STORED_AGENT_LEVELS.comment ? "comment" : "view";
}
