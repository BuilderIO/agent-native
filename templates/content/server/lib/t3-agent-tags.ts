import type { T3CodeAgentKind } from "@agent-native/core/mcp-client";

import {
  isT3AgentMention,
  type CommentMention,
} from "../../shared/comment-mentions.js";

const T3_AGENT_KINDS = new Set<string>(["claude-code", "codex"]);

export interface T3AgentTag {
  agent: T3CodeAgentKind;
  t3ThreadId: string | null;
}

export function t3AgentTags(mentions: readonly CommentMention[]): T3AgentTag[] {
  const tags = new Map<T3CodeAgentKind, T3AgentTag>();
  for (const mention of mentions) {
    if (!isT3AgentMention(mention) || !T3_AGENT_KINDS.has(mention.model))
      continue;
    const agent = mention.model as T3CodeAgentKind;
    if (!tags.has(agent))
      tags.set(agent, { agent, t3ThreadId: mention.thread ?? null });
  }
  return [...tags.values()];
}
