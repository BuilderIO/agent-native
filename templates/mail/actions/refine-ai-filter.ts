import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import {
  aiFilterPreviewCorrectionSchema,
  aiFilterPreviewRuleSchema,
} from "@shared/ai-filter.js";
import { z } from "zod";

import { rewriteAutomationRuleCondition } from "../server/lib/automation-engine.js";
import {
  listAutomationRules,
  updateAutomationRule,
} from "../server/lib/automations.js";

export default defineAction({
  description:
    "Rewrite a Mail AI tag or spam rule from checked recent-email corrections, then save the new instruction.",
  schema: z.object({
    ruleId: z.string().min(1).max(64),
    corrections: z.array(aiFilterPreviewCorrectionSchema).min(1).max(30),
    comment: z.string().max(500).optional(),
  }),
  agentTool: false,
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
    return { rule: updated };
  },
});
