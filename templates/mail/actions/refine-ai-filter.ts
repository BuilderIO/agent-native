import { defineAction } from "@agent-native/core/action";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { aiFilterRuleMode } from "@shared/ai-filter-rules.js";
import {
  AI_FILTER_MIN_LEARNED_EXAMPLES,
  AI_FILTER_RULE_NAME,
} from "@shared/ai-filter.js";
import {
  aiFilterPreviewCorrectionSchema,
  aiFilterPreviewRuleSchema,
} from "@shared/ai-filter.js";
import { z } from "zod";

import { startMailAiFilterBackfill } from "../server/lib/ai-filter-backfill.js";
import { getAiFilterState } from "../server/lib/ai-filter.js";
import { rewriteAutomationRuleCondition } from "../server/lib/automation-engine.js";
import {
  listAutomationRules,
  updateAutomationRule,
} from "../server/lib/automations.js";

export default defineAction({
  description:
    "Rewrite a Mail AI rule from checked email corrections and save it. The learned-example rule is queued against recent inbox mail after three confirmed examples. Returns the rule, backfill status and run id when started, the confirmed-example count when waiting, and a link to edit the rule in Settings.",
  schema: z.object({
    ruleId: z.string().min(1).max(64),
    corrections: z.array(aiFilterPreviewCorrectionSchema).min(1).max(30),
    comment: z.string().max(500).optional(),
  }),
  agentTool: true,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    const rule = (await listAutomationRules(ownerEmail)).find(
      (candidate) =>
        candidate.id === args.ruleId && candidate.kind === "ai-filter",
    );
    if (!rule) throw new Error("Mail AI rule not found.");

    const nextCondition = await rewriteAutomationRuleCondition(
      ownerEmail,
      aiFilterPreviewRuleSchema.parse(rule),
      args.corrections,
      args.comment,
    );
    const updated = await updateAutomationRule(ownerEmail, rule.id, {
      condition: nextCondition,
    });
    const mode = aiFilterRuleMode(updated);
    const result = {
      rule: updated,
      id: updated.id,
      mode: mode === "filtered" ? "filter" : mode,
      sentence: updated.condition,
      enabled: updated.enabled,
      appliedCounts: null,
      backfillRunId: undefined,
      settingsHref: buildDeepLink({
        app: "mail",
        view: "settings",
        to: "/settings?section=ai-filter",
      }),
    };
    let backfillRunId: string | undefined;
    let backfillStatus: "queued" | "failed" | "not-started-disabled" =
      updated.enabled ? "failed" : "not-started-disabled";
    if (updated.enabled) {
      try {
        if (updated.name === AI_FILTER_RULE_NAME) {
          const learnedExampleCount = (await getAiFilterState(ownerEmail))
            .feedback.length;
          if (learnedExampleCount < AI_FILTER_MIN_LEARNED_EXAMPLES) {
            return {
              ...result,
              backfillStatus: "waiting-for-examples" as const,
              learnedExampleCount,
            };
          }
        }
        ({ runId: backfillRunId, status: backfillStatus } =
          await startMailAiFilterBackfill(ownerEmail, [updated.id]));
      } catch {
        backfillStatus = "failed";
      }
    }
    return {
      ...result,
      backfillStatus,
      ...(backfillRunId ? { backfillRunId } : {}),
    };
  },
});
