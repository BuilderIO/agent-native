import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import {
  getDecisionsStatus,
  JEV_DECISIONS_MODEL,
  OPENAI_DECISIONS_MODEL,
  type DecisionAnswer,
  type DecisionProvider,
} from "@agent-native/core/decisions";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
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
  aiPriorityEmailKey,
  aiPriorityEmailSchema,
  type AiPriorityScore,
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

function modelForProvider(provider: DecisionProvider): string {
  return provider === "jev" ? JEV_DECISIONS_MODEL : OPENAI_DECISIONS_MODEL;
}

function instructionIdentity(
  rules: ReturnType<typeof importantRules>,
  instruction: string,
): string {
  return hash(
    JSON.stringify(
      rules.length
        ? rules.map((rule) => `${rule.id}:${rule.updatedAt}:${rule.condition}`)
        : [instruction],
    ),
  );
}

function instructionKey(
  provider: DecisionProvider,
  model: string,
  identity: string,
): string {
  const modelIdentity =
    provider === "jev"
      ? { engine: "typesafe", model }
      : { engine: "decisions", provider, model };
  return hash(JSON.stringify({ model: modelIdentity, identity }));
}

function readyDecisionProviders(
  status: Awaited<ReturnType<typeof getDecisionsStatus>>,
): DecisionProvider[] {
  return [...new Set(status.providerOrder)].filter((provider) =>
    status.providers.some(
      (candidate) =>
        candidate.provider === provider && candidate.status === "ready",
    ),
  );
}

export default defineAction({
  description:
    "Score up to 500 newest, non-archived Inbox emails for a cached Priority sort using Mail Important rules. Uses the configured decision provider and returns per-email failures without fabricating scores.",
  schema: z.object({
    emails: z.array(aiPriorityEmailSchema).max(AI_PRIORITY_MAX_EMAILS),
  }),
  agentTool: false,
  run: async ({ emails }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) fail("Unauthenticated", { errorCode: "unauthenticated" });
    const status = await getDecisionsStatus(ownerEmail);
    const readyProviders = readyDecisionProviders(status);
    const selectedProvider = readyProviders.slice(0, 1).pop();
    if (!selectedProvider) {
      if (status.providers.some(({ status }) => status === "unknown")) {
        fail("Decision provider availability could not be checked.", {
          errorCode: "jev_availability_failed",
          statusCode: 503,
        });
      }
      fail("Connect an AI provider to use Priority sort.", {
        // The code remains stable for clients that still map this legacy name.
        errorCode: "jev_not_enabled",
        statusCode: 403,
      });
    }

    const [rules, cache, storedFeedback] = await Promise.all([
      listAutomationRules(ownerEmail),
      getAiPriorityCache(ownerEmail),
      getUserSetting(ownerEmail, "ai-priority-feedback"),
    ]);
    const priorityRules = importantRules(rules);
    const instruction = priorityRules.length
      ? priorityRules.map((rule) => rule.condition.trim()).join("\n")
      : AI_PRIORITY_DEFAULT_INSTRUCTION;
    const identity = instructionIdentity(priorityRules, instruction);
    const selectedModel = modelForProvider(selectedProvider);
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
    const fingerprints = eligibleEmails.map((email) => ({
      id: email.id,
      ...(email.accountEmail ? { accountEmail: email.accountEmail } : {}),
      fingerprint: emailFingerprint(email),
    }));
    const scores = new Map<string, AiPriorityScore>();
    let cachedModel: { provider: DecisionProvider; model: string } | null =
      null;
    for (const provider of readyProviders) {
      const model = modelForProvider(provider);
      const providerScores = getCachedPriorityScores(
        cache,
        fingerprints,
        instructionKey(provider, model, identity),
        provider,
        model,
      );
      if (providerScores.size > 0 && cachedModel === null) {
        cachedModel = { provider, model };
      }
      for (const [key, score] of providerScores) {
        if (!scores.has(key)) scores.set(key, score);
      }
      if (scores.size === fingerprints.length) break;
    }
    const feedbackValue =
      storedFeedback &&
      typeof storedFeedback === "object" &&
      "entries" in storedFeedback
        ? storedFeedback.entries
        : (storedFeedback ?? []);
    const feedback = z
      .array(
        z.object({
          emailId: z.string(),
          accountEmail: z.string().email().optional(),
          decision: z.enum(["important", "not-important"]),
          createdAt: z.number().int(),
        }),
      )
      .max(500)
      .safeParse(feedbackValue);
    if (!feedback.success) {
      throw new Error("Stored importance feedback is unreadable.");
    }
    const eligibleKeys = new Set(
      fingerprints.map((email) =>
        aiPriorityEmailKey(email.accountEmail, email.id),
      ),
    );
    for (const item of feedback.data) {
      const key = aiPriorityEmailKey(item.accountEmail, item.emailId);
      if (eligibleKeys.has(key)) {
        scores.set(key, {
          emailId: item.emailId,
          ...(item.accountEmail ? { accountEmail: item.accountEmail } : {}),
          score: item.decision === "important" ? 1 : 0,
        });
      }
    }
    const pending = eligibleEmails.filter(
      (email) => !scores.has(aiPriorityEmailKey(email.accountEmail, email.id)),
    );
    let evaluatedCount = 0;
    let failedCount = 0;
    let failures: Array<{
      emailId: string;
      accountEmail?: string;
      reason: "invalid_response" | "refusal";
    }> = [];
    let model: { provider: DecisionProvider; model: string } = cachedModel ?? {
      provider: selectedProvider,
      model: selectedModel,
    };

    if (pending.length > 0) {
      const result = await previewAutomationPriority(
        pending,
        ownerEmail,
        instruction,
        AbortSignal.timeout(25_000),
      );
      evaluatedCount = result.evaluatedCount;
      failedCount = result.failedCount;
      failures = result.failures;
      model = result.model ?? model;
      const failureKeys = new Set(
        failures.map((failure) =>
          aiPriorityEmailKey(failure.accountEmail, failure.emailId),
        ),
      );
      const now = Date.now();
      const entries: AiPriorityCacheEntry[] = [];
      for (const email of pending) {
        const key = aiPriorityEmailKey(email.accountEmail, email.id);
        const score = result.scores.get(key);
        if (!score) {
          if (!failureKeys.has(key)) {
            fail("Priority decision returned an unclassified email.", {
              errorCode: "decision_invalid_response",
              statusCode: 502,
            });
          }
          continue;
        }
        if (
          !Number.isFinite(score.score) ||
          score.score < 0 ||
          score.score > 1
        ) {
          fail("Priority decision returned an invalid score.", {
            errorCode: "decision_invalid_response",
            statusCode: 502,
          });
        }
        const entry: AiPriorityCacheEntry = {
          emailId: email.id,
          ...(email.accountEmail ? { accountEmail: email.accountEmail } : {}),
          score: score.score,
          fingerprint: emailFingerprint(email),
          instructionKey: instructionKey(score.provider, score.model, identity),
          instructionIdentity: identity,
          evaluatedAt: now,
          provider: score.provider,
          model: score.model,
        };
        if (score.reason) entry.reason = score.reason;
        entries.push(entry);
        scores.set(key, {
          emailId: email.id,
          ...(email.accountEmail ? { accountEmail: email.accountEmail } : {}),
          score: score.score,
          ...(score.reason ? { reason: score.reason } : {}),
        });
      }
      if (result.evaluatedCount + result.failedCount !== pending.length) {
        fail("Priority decision returned incomplete results.", {
          errorCode: "decision_invalid_response",
          statusCode: 502,
        });
      }
      if (entries.length > 0) {
        const latestCache = await getAiPriorityCache(ownerEmail);
        await saveAiPriorityCache(
          ownerEmail,
          mergePriorityCache(latestCache, entries, {
            provider: model.provider,
            model: model.model,
          }),
        );
      }
    }

    return {
      scores: eligibleEmails.flatMap((email) => {
        const score = scores.get(
          aiPriorityEmailKey(email.accountEmail, email.id),
        );
        return score ? [score] : [];
      }),
      failures,
      eligibleCount: eligibleEmails.length,
      evaluatedCount,
      failedCount,
      limit: AI_PRIORITY_MAX_EMAILS,
      model,
    };
  },
});
