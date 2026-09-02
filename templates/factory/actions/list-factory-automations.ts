import { defineAction } from "@agent-native/core/action";
import { listAutomationRuns } from "@agent-native/core/triggers";
import { z } from "zod";

import { readFactoryDefinition } from "../server/factory-graph/store.js";
import {
  buildGuardrailsText,
  extractGuardrails,
  readFactoryAutomationConfig,
  stripInjectedAutomationBlocks,
} from "../server/lib/factory-automation-config.js";
import { listFactoryAutomationDefinitions } from "../server/lib/factory-automation-resources.js";
import {
  DEFAULT_FACTORY_ID,
  factoryAutomationRunHistoryKey,
  factoryIdSchema,
  factoryAutomationRunHistoryKey,
  readAutomationFactoryId,
  resolveAutomationDisplayName,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "List the organization-scoped Factory automations with their trigger, editable prompt, model, schedule, enabled state, and recent runs.",
  agentTool: false,
  schema: z.object({ factoryId: factoryIdSchema }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ factoryId }, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const factory = await readFactoryDefinition(orgId, factoryId);
    if (!factory && factoryId !== DEFAULT_FACTORY_ID) {
      throw new Error("Factory not found.");
    }
    const scoped = await listFactoryAutomationDefinitions(orgId, factoryId);
    return Promise.all(
      scoped.map(async ({ resource, name, meta }) => {
        const runs = await listAutomationRuns({
          owners: [resource.owner],
          automation: factoryAutomationRunHistoryKey(resource.path),
          appId: "factory",
          limit: 20,
        });
        const config = readFactoryAutomationConfig(resource.content, name);
        const prompt = stripInjectedAutomationBlocks(resource.content);
        const factoryIdFromJob = readAutomationFactoryId(
          meta,
          resource.content,
          resource.path,
        );
        return {
          id: resource.id,
          name,
          displayName: resolveAutomationDisplayName(name, resource.content),
          prompt,
          body: prompt,
          model: meta.model ?? null,
          schedule: meta.schedule || null,
          enabled: meta.enabled,
          triggerType: meta.triggerType,
          event: meta.event ?? null,
          timezone: config.timezone ?? meta.timezone ?? null,
          condition: meta.condition ?? null,
          createdBy: meta.createdBy ?? null,
          source: config.source,
          template: config.template,
          slackWorkspace: config.slackWorkspace,
          slackChannelId: config.slackChannelId,
          slackChannelName: config.slackChannelName,
          repository: config.repository,
          sentryOrgSlug: config.sentryOrgSlug,
          sentryProjectSlug: config.sentryProjectSlug,
          sentryEnvironment: config.sentryEnvironment,
          authorMode: config.authorMode,
          authorIds: config.authorIds,
          scheduleMode: config.scheduleMode,
          intervalMinutes: config.intervalMinutes,
          dailyHour: config.dailyHour,
          dailyMinute: config.dailyMinute,
          inboxLimit: config.inboxLimit,
          workLimit: config.workLimit,
          guardrails:
            extractGuardrails(resource.content) ||
            buildGuardrailsText(factoryIdFromJob, config),
          updatedAt:
            Number.isFinite(resource.updatedAt) && resource.updatedAt > 0
              ? new Date(resource.updatedAt).toISOString()
              : null,
          canUpdate: true,
          runs: runs.filter((run) => run.path === resource.path),
        };
      }),
    );
  },
});
