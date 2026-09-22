import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  getAiPriorityCache,
  getCachedPriorityScores,
  mergePriorityCache,
  saveAiPriorityCache,
  type AiPriorityCacheEntry,
} from "../server/lib/ai-priority.js";
import { previewAutomationPriority } from "../server/lib/automation-engine.js";
import { listAutomationRules } from "../server/lib/automations.js";
import {
  AI_IMPORTANT_LABEL,
  AI_PRIORITY_DEFAULT_INSTRUCTION,
  AI_PRIORITY_MAX_EMAILS,
  aiPriorityEmailSchema,
} from "../shared/ai-priority.js";
import { mailLabelsInclude } from "../shared/gmail-labels.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function emailFingerprint(
  email: z.infer<typeof aiPriorityEmailSchema>,
): string {
  return hash(
    JSON.stringify({
      id: email.id,
      date: email.date,
      from: email.from,
      to: email.to,
      subject: email.subject,
      snippet: email.snippet,
      labelIds: email.labelIds,
    }),
  );
}

function importantRules(
  rules: Awaited<ReturnType<typeof listAutomationRules>>,
) {
  return rules.filter(
    (rule) =>
      rule.kind === "ai-filter" &&
      rule.enabled &&
      rule.actions.some(
        (action) =>
          action.type === "label" && action.labelName === AI_IMPORTANT_LABEL,
      ) &&
      !rule.actions.some((action) => action.type === "archive"),
  );
}

export default defineAction({
  description:
    "Score up to 500 newest, non-archived Inbox emails for a cached Priority sort using the Mail Important rules. Archived, auto-archived, trashed, and non-Inbox emails are never evaluated.",
  schema: z.object({
    emails: z.array(aiPriorityEmailSchema).max(AI_PRIORITY_MAX_EMAILS),
  }),
  agentTool: false,
  run: async ({ emails }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    const rules = importantRules(await listAutomationRules(ownerEmail));
    const instruction = rules.length
      ? rules.map((rule) => rule.condition.trim()).join("\n")
      : AI_PRIORITY_DEFAULT_INSTRUCTION;
    const instructionKey = hash(
      rules.length
        ? rules
            .map((rule) => `${rule.id}:${rule.updatedAt}:${rule.condition}`)
            .join("\n")
        : instruction,
    );
    const eligibleEmails = emails
      .filter(
        (email) =>
          !email.isArchived &&
          !email.isTrashed &&
          mailLabelsInclude(email.labelIds, "inbox"),
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, AI_PRIORITY_MAX_EMAILS);
    const cache = await getAiPriorityCache(ownerEmail);
    const fingerprints = eligibleEmails.map((email) => ({
      id: email.id,
      fingerprint: emailFingerprint(email),
    }));
    const scores = getCachedPriorityScores(cache, fingerprints, instructionKey);
    const pending = eligibleEmails.filter((email) => !scores.has(email.id));
    let model = cache.model;

    if (pending.length > 0) {
      const result = await previewAutomationPriority(
        pending,
        ownerEmail,
        instruction,
      );
      model = result.model;
      const now = Date.now();
      const entries: AiPriorityCacheEntry[] = pending.map((email) => {
        const score = result.scores.get(email.id) ?? { score: 0.5 };
        const entry: AiPriorityCacheEntry = {
          emailId: email.id,
          score: score.score,
          fingerprint: emailFingerprint(email),
          instructionKey,
          evaluatedAt: now,
        };
        if (score.reason) entry.reason = score.reason;
        return entry;
      });
      await saveAiPriorityCache(
        ownerEmail,
        mergePriorityCache(cache, entries, model),
      );
      for (const entry of entries) {
        scores.set(entry.emailId, {
          emailId: entry.emailId,
          score: entry.score,
          ...(entry.reason ? { reason: entry.reason } : {}),
        });
      }
    }

    return {
      scores: eligibleEmails.map(
        (email) =>
          scores.get(email.id) ?? {
            emailId: email.id,
            score: 0.5,
          },
      ),
      eligibleCount: eligibleEmails.length,
      evaluatedCount: pending.length,
      limit: AI_PRIORITY_MAX_EMAILS,
      model,
    };
  },
});
