import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  defaultAutomationConfig,
  sourceForTemplate,
  type FactoryAutomationTemplateId,
} from "../server/lib/factory-automation-config.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { factoryAutomationTemplatePrompt } from "../server/plugins/factory-scheduler-job.js";

const TEMPLATES: FactoryAutomationTemplateId[] = [
  "slack-feedback",
  "github-issues",
  "pr-governance",
  "pr-babysit",
  "sentry-errors",
  "blank",
];

export default defineAction({
  description:
    "List Factory automation templates. Each template fills a prompt and default schedule and limits only.",
  agentTool: false,
  schema: z.object({
    source: z.enum(["slack", "github", "sentry"]).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ source }, context) => {
    await requireWorkspaceMember(workspaceMemberIdentityFromContext(context));
    return TEMPLATES.filter((template) => {
      if (template === "blank") return true;
      if (!source) return true;
      return sourceForTemplate(template) === source;
    }).map((template) => {
      const templateSource = sourceForTemplate(template) ?? source ?? "slack";
      const defaults = defaultAutomationConfig(templateSource, template);
      return {
        id: template,
        source: template === "blank" ? null : templateSource,
        prompt: factoryAutomationTemplatePrompt(template, templateSource),
        scheduleMode: defaults.scheduleMode,
        intervalMinutes: defaults.intervalMinutes,
        dailyHour: defaults.dailyHour,
        dailyMinute: defaults.dailyMinute,
        timezone: defaults.timezone,
        inboxLimit: defaults.inboxLimit,
        workLimit: defaults.workLimit,
      };
    });
  },
});
