import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import {
  aiFilterPreviewEmailSchema,
  aiFilterPreviewMatchSchema,
  aiFilterPreviewRuleSchema,
} from "@shared/ai-filter.js";
import { aiPriorityEmailKey } from "@shared/ai-priority.js";
import { z } from "zod";

import { getAiFilterState } from "../server/lib/ai-filter.js";
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
    const state = await getAiFilterState(ownerEmail);

    if (rules.length === 0 || emails.length === 0) {
      return {
        model: null,
        rules,
        emails: emails.map((email) => ({ ...email, matches: [] })),
      };
    }

    const { matches, model } = await previewAutomationRules(
      emails,
      rules,
      ownerEmail,
      state,
    );
    return {
      model,
      rules,
      emails: emails.map((email) => ({
        ...email,
        matches: z
          .array(aiFilterPreviewMatchSchema)
          .parse(
            matches.get(aiPriorityEmailKey(email.accountEmail, email.id)) ?? [],
          ),
      })),
    };
  },
});
