import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import {
  getJevContextCredentials,
  getRequestUserEmail,
  isJevEnabled,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  getAiPriorityCache,
  getCachedPriorityScores,
  mergePriorityCache,
  saveAiPriorityCache,
  type AiPriorityCacheEntry,
} from "../server/lib/ai-priority.js";
import { previewAutomationPriority } from "../server/lib/automation-engine.js";
import {
  TYPESAFE_AUTOMATION_ENGINE,
  TYPESAFE_AUTOMATION_MODEL,
  type AutomationModelSettings,
} from "../server/lib/automation-model.js";
import { listAutomationRules } from "../server/lib/automations.js";
import {
  AI_IMPORTANT_LABEL,
  AI_PRIORITY_DEFAULT_INSTRUCTION,
  AI_PRIORITY_MAX_EMAILS,
  aiPriorityEmailKey,
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
      accountEmail: email.accountEmail,
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
  return rules
    .filter(
      (rule) =>
        rule.domain === "mail" &&
        rule.kind === "ai-filter" &&
        rule.enabled &&
        rule.actions.some(
          (action) =>
            action.type === "label" && action.labelName === AI_IMPORTANT_LABEL,
        ) &&
        !rule.actions.some((action) => action.type === "archive"),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

export default defineAction({
  description:
    "Score up to 500 newest, non-archived Inbox emails with Jev for a cached Priority sort using Mail Important rules. Requires Builder Jev access or a direct Jev API key.",
  schema: z.object({
    emails: z.array(aiPriorityEmailSchema).max(AI_PRIORITY_MAX_EMAILS),
  }),
  agentTool: false,
  run: async ({ emails }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) fail("Unauthenticated", { errorCode: "unauthenticated" });
    const jevCredentials = await getJevContextCredentials(ownerEmail);
    if (!(await isJevEnabled(jevCredentials))) {
      fail("Jev is not enabled for this account.", {
        errorCode: "jev_not_enabled",
        statusCode: 403,
      });
    }

    const rules = importantRules(await listAutomationRules(ownerEmail));
    const instruction = rules.length
      ? rules.map((rule) => rule.condition.trim()).join("\n")
      : AI_PRIORITY_DEFAULT_INSTRUCTION;
    const modelSettings = {
      engine: TYPESAFE_AUTOMATION_ENGINE,
      model: TYPESAFE_AUTOMATION_MODEL,
    };
    const instructionKey = hash(
      JSON.stringify({
        model: modelSettings,
        rules: rules.length
          ? rules.map(
              (rule) => `${rule.id}:${rule.updatedAt}:${rule.condition}`,
            )
          : [instruction],
      }),
    );
    const eligibleEmails = emails
      .filter(
        (email) =>
          !email.isArchived &&
          !email.isTrashed &&
          mailLabelsInclude(email.labelIds, "inbox"),
      )
      .sort(
        (a, b) =>
          new Date(b.date).getTime() - new Date(a.date).getTime() ||
          b.id.localeCompare(a.id),
      )
      .slice(0, AI_PRIORITY_MAX_EMAILS);
    const cache = await getAiPriorityCache(ownerEmail);
    const fingerprints = eligibleEmails.map((email) => ({
      id: email.id,
      accountEmail: email.accountEmail,
      fingerprint: emailFingerprint(email),
    }));
    const scores = getCachedPriorityScores(cache, fingerprints, instructionKey);
    const pending = eligibleEmails.filter(
      (email) => !scores.has(aiPriorityEmailKey(email.accountEmail, email.id)),
    );
    let model: AutomationModelSettings = modelSettings;

    if (pending.length > 0) {
      const result = await previewAutomationPriority(
        pending,
        ownerEmail,
        instruction,
        jevCredentials,
        AbortSignal.timeout(25_000),
      );
      model = result.model;
      const incomplete = pending.some((email) => {
        const score = result.scores.get(
          aiPriorityEmailKey(email.accountEmail, email.id),
        )?.score;
        return (
          score === undefined ||
          !Number.isFinite(score) ||
          score < 0 ||
          score > 1
        );
      });
      if (incomplete) {
        throw new Error(
          "Priority model returned incomplete results. Run Priority again.",
        );
      }
      const now = Date.now();
      const entries: AiPriorityCacheEntry[] = pending.map((email) => {
        const score = result.scores.get(
          aiPriorityEmailKey(email.accountEmail, email.id),
        );
        if (!score)
          throw new Error("Priority model returned an invalid result.");
        const entry: AiPriorityCacheEntry = {
          emailId: email.id,
          accountEmail: email.accountEmail,
          score: score.score,
          fingerprint: emailFingerprint(email),
          instructionKey,
          evaluatedAt: now,
        };
        if (score.reason) entry.reason = score.reason;
        return entry;
      });
      const latestCache = await getAiPriorityCache(ownerEmail);
      await saveAiPriorityCache(
        ownerEmail,
        mergePriorityCache(latestCache, entries, model),
      );
      for (const entry of entries) {
        const key = aiPriorityEmailKey(entry.accountEmail, entry.emailId);
        scores.set(key, {
          emailId: entry.emailId,
          ...(entry.accountEmail ? { accountEmail: entry.accountEmail } : {}),
          score: entry.score,
          ...(entry.reason ? { reason: entry.reason } : {}),
        });
      }
    }

    return {
      scores: eligibleEmails.map((email) => {
        const key = aiPriorityEmailKey(email.accountEmail, email.id);
        return (
          scores.get(key) ?? {
            emailId: email.id,
            ...(email.accountEmail ? { accountEmail: email.accountEmail } : {}),
            score: 0.5,
          }
        );
      }),
      eligibleCount: eligibleEmails.length,
      evaluatedCount: pending.length,
      limit: AI_PRIORITY_MAX_EMAILS,
      model,
    };
  },
});
