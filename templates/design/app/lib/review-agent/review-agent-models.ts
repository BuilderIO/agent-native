import type { EngineModelGroup } from "@agent-native/core/client/agent-chat";
import type { ReviewMention } from "@agent-native/core/review";
import type { ReviewMentionOption } from "@agent-native/toolkit/app/review";
import {
  agentMentionId,
  modelDisplayName,
} from "@shared/review-agent-identity";

export interface ReviewAgentSelection {
  model: string;
  engine: string;
  provider: string;
}

// Mirrors `agentMentionId`; the toolkit's chip and picker key on this prefix.
const AGENT_MENTION_ID_PREFIX = "agent:";

export function isAgentMention(mention: ReviewMention): boolean {
  return Boolean(mention.id?.startsWith(AGENT_MENTION_ID_PREFIX));
}

/** The first agent chip in a comment wins; any others stay plain mentions. */
export function firstAgentMention(
  mentions: readonly ReviewMention[],
): ReviewMention | null {
  return mentions.find(isAgentMention) ?? null;
}

/**
 * One selection per model name. With Builder.io connected, a provider key adds
 * its own group, and the two name one model differently ("gpt-5-4", "gpt-5.4"),
 * so ids alone can't dedupe them. The current choice wins, then its engine,
 * then the first group listed.
 */
export function reviewAgentSelections(
  groups: readonly Pick<EngineModelGroup, "engine" | "label" | "models">[],
  current: { model: string; engine: string },
): ReviewAgentSelection[] {
  const rank = (selection: ReviewAgentSelection) =>
    selection.engine !== current.engine
      ? 0
      : selection.model === current.model
        ? 2
        : 1;
  const byName = new Map<string, ReviewAgentSelection>();
  for (const group of groups) {
    for (const model of group.models) {
      const selection = { model, engine: group.engine, provider: group.label };
      const name = modelDisplayName(model);
      const kept = byName.get(name);
      if (!kept || rank(selection) > rank(kept)) byName.set(name, selection);
    }
  }
  return [...byName.values()];
}

export function reviewAgentMentionOption(
  selection: ReviewAgentSelection,
): ReviewMentionOption {
  return {
    id: agentMentionId(selection),
    label: modelDisplayName(selection.model),
    email: null,
    description: selection.provider,
  };
}

/** The live selection a stored chip names, or null once that model is gone. */
export function resolveReviewAgentMention(
  selections: readonly ReviewAgentSelection[],
  mention: ReviewMention,
): ReviewAgentSelection | null {
  if (!mention.id) return null;
  return (
    selections.find((selection) => agentMentionId(selection) === mention.id) ??
    null
  );
}
