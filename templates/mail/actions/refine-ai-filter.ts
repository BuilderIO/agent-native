import { defineAction } from "@agent-native/core/action";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { aiFilterRuleMode } from "@shared/ai-filter-rules.js";
import {
  aiFilterPreviewCorrectionSchema,
  aiFilterPreviewRuleSchema,
} from "@shared/ai-filter.js";
import { z } from "zod";

import { startMailAiFilterBackfill } from "../server/lib/ai-filter-backfill.js";
import { rewriteAutomationRuleCondition } from "../server/lib/automation-engine.js";
import {
  listAutomationRules,
  updateAutomationRule,
} from "../server/lib/automations.js";

export default defineAction({
  description:
    "Rewrite a Mail AI rule from checked email corrections, save it, and queue it against recent inbox mail. Returns the rule, queued backfill id/status, and a link to edit the rule in Settings.",
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
    let backfillRunId: string | undefined;
    let backfillStatus: "queued" | "failed" | "not-started-disabled" =
      updated.enabled ? "failed" : "not-started-disabled";
    if (updated.enabled) {
      try {
        ({ runId: backfillRunId, status: backfillStatus } =
          await startMailAiFilterBackfill(ownerEmail, [updated.id]));
      } catch {
        backfillStatus = "failed";
      }
    }
    const mode = aiFilterRuleMode(updated);
    return {
      rule: updated,
      id: updated.id,
      mode: mode === "filtered" ? "filter" : mode,
      sentence: updated.condition,
      enabled: updated.enabled,
      appliedCounts: null,
      backfillStatus,
      ...(backfillRunId ? { backfillRunId } : {}),
      settingsHref: buildDeepLink({
        app: "mail",
        view: "settings",
        to: "/settings?section=ai-filter",
      }),
    };
  },
});
