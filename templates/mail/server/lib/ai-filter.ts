import {
  getUserSetting,
  mutateUserSetting,
  putUserSetting,
} from "@agent-native/core/settings";
import { nanoid } from "nanoid";

import {
  aiFilterStateSchema,
  createDefaultAiFilterState,
  type AiFilterDecision,
  type AiFilterFeedback,
  type AiFilterState,
  type AiFilterTarget,
} from "../../shared/ai-filter.js";

const AI_FILTER_SETTING_KEY = "ai-filter-state";
const MAX_FEEDBACK = 100;
const MAX_DECISIONS = 200;

function parseAiFilterState(stored: unknown): AiFilterState {
  if (stored === undefined || stored === null) {
    return createDefaultAiFilterState();
  }

  const parsed = aiFilterStateSchema.safeParse(stored);
  if (!parsed.success) {
    throw new Error(
      "AI filter settings are unreadable; reset them in Mail settings.",
    );
  }
  return parsed.data;
}

export async function getAiFilterState(
  ownerEmail: string,
): Promise<AiFilterState> {
  const stored = await getUserSetting(ownerEmail, AI_FILTER_SETTING_KEY);
  return parseAiFilterState(stored);
}

export async function saveAiFilterState(
  ownerEmail: string,
  state: AiFilterState,
): Promise<AiFilterState> {
  const parsed = aiFilterStateSchema.safeParse(state);
  if (!parsed.success) {
    throw new Error("Invalid AI filter settings.");
  }
  await putUserSetting(ownerEmail, AI_FILTER_SETTING_KEY, parsed.data);
  return parsed.data;
}

function bounded(value: string | undefined, max: number): string {
  return (value ?? "").slice(0, max);
}

export async function recordAiFilterFeedback(
  ownerEmail: string,
  input: {
    targets: AiFilterTarget[];
    disposition: "spam" | "not_spam";
    comment?: string;
  },
): Promise<AiFilterState> {
  const now = Date.now();
  const comment = input.comment?.trim()
    ? bounded(input.comment.trim(), 500)
    : undefined;
  const feedback: AiFilterFeedback[] = input.targets.map((target) => ({
    id: nanoid(12),
    disposition: input.disposition,
    sender: bounded(target.sender, 320),
    subject: bounded(target.subject, 500),
    ...(comment ? { comment } : {}),
    createdAt: now,
  }));
  const decisions: AiFilterDecision[] = input.targets.map((target) => ({
    id: nanoid(12),
    messageId: target.id,
    ...(target.threadId ? { threadId: target.threadId } : {}),
    ...(target.accountEmail ? { accountEmail: target.accountEmail } : {}),
    sender: bounded(target.sender, 320),
    subject: bounded(target.subject, 500),
    disposition: input.disposition === "spam" ? "filtered" : "kept",
    source: "manual",
    ...(comment ? { reason: comment } : {}),
    createdAt: now,
  }));

  // ponytail: move this capped ledger to a table when review history needs
  // search or pagination.
  const updated = await mutateUserSetting(
    ownerEmail,
    AI_FILTER_SETTING_KEY,
    (current) => {
      const state = parseAiFilterState(current);
      const next = {
        ...state,
        feedback: [...state.feedback, ...feedback].slice(-MAX_FEEDBACK),
        decisions: [...state.decisions, ...decisions].slice(-MAX_DECISIONS),
      };
      const parsed = aiFilterStateSchema.safeParse(next);
      if (!parsed.success) throw new Error("Invalid AI filter settings.");
      return parsed.data;
    },
  );
  return parseAiFilterState(updated);
}

export async function recordAiFilterDecisions(
  ownerEmail: string,
  decisions: AiFilterDecision[],
): Promise<AiFilterState> {
  if (decisions.length === 0) return getAiFilterState(ownerEmail);
  const updated = await mutateUserSetting(
    ownerEmail,
    AI_FILTER_SETTING_KEY,
    (current) => {
      const state = parseAiFilterState(current);
      const byId = new Map(
        state.decisions.map((decision) => [decision.id, decision]),
      );
      for (const decision of decisions) byId.set(decision.id, decision);
      const next = {
        ...state,
        decisions: [...byId.values()].slice(-MAX_DECISIONS),
      };
      const parsed = aiFilterStateSchema.safeParse(next);
      if (!parsed.success) throw new Error("Invalid AI filter settings.");
      return parsed.data;
    },
  );
  return parseAiFilterState(updated);
}
