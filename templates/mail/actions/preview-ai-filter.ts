import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import {
  aiFilterPreviewEmailSchema,
  aiFilterPreviewFailureSchema,
  aiFilterPreviewMatchSchema,
  aiFilterPreviewRuleSchema,
} from "@shared/ai-filter.js";
import { aiPriorityEmailKey } from "@shared/ai-priority.js";
import { z } from "zod";

import { previewAutomationRules } from "../server/lib/automation-engine.js";
import { listAutomationRules } from "../server/lib/automations.js";

export default defineAction({
  description:
    "Preview active Mail AI tag and spam rules against recent Inbox emails. Archived and trashed messages are ignored.",
  schema: z.object({
    emails: z.array(aiFilterPreviewEmailSchema).max(30),
  }),
  readOnly: true,
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    const rules = (await listAutomationRules(ownerEmail))
      .filter((rule) => rule.kind === "ai-filter" && rule.enabled)
      .map((rule) => aiFilterPreviewRuleSchema.parse(rule));
    const emails = args.emails.filter(
      (email) => !email.isArchived && !email.isTrashed,
    );
    if (rules.length === 0 || emails.length === 0) {
      return {
        model: null,
        evaluatedCount: 0,
        failedCount: 0,
        failures: [],
        rules,
        emails: emails.map((email) => ({ ...email, matches: [] })),
      };
    }

    const evaluation = await previewAutomationRules(emails, rules, ownerEmail);
    return {
      model: evaluation.model,
      evaluatedCount: evaluation.evaluatedCount,
      failedCount: evaluation.failedCount,
      failures: z
        .array(aiFilterPreviewFailureSchema)
        .parse(evaluation.failures),
      rules,
      emails: emails.map((email) => ({
        ...email,
        matches: z
          .array(aiFilterPreviewMatchSchema)
          .parse(
            evaluation.matches.get(
              aiPriorityEmailKey(email.accountEmail, email.id),
            ) ?? [],
          ),
      })),
    };
  },
});
