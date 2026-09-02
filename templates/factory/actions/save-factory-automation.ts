import { defineAction, fail } from "@agent-native/core/action";
import { isValidCron, nextOccurrence } from "@agent-native/core/jobs";
import {
  resourceGetByPath,
  resourcePutIfCurrent,
} from "@agent-native/core/resources";
import { z } from "zod";

import {
  VaultUnavailableError,
  assertFactoryConnectorReady,
} from "../server/connectors/credentials.js";
import {
  FACTORY_INBOX_LIMIT_MAX,
  FACTORY_WORK_LIMIT_MAX,
  applyAutomationConfigFrontmatter,
  assertAuthorFilter,
  clampInboxLimit,
  clampWorkLimit,
  readFactoryAutomationConfig,
  replaceUserPrompt,
  scheduleCron,
} from "../server/lib/factory-automation-config.js";
import { findFactoryAutomationDefinition } from "../server/lib/factory-automation-resources.js";
import {
  factoryIdSchema,
  readAutomationEnabled,
  readAutomationModel,
  readAutomationSchedule,
  resolveAutomationDisplayName,
  setAutomationFrontmatterField,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Edit a Factory automation's display name, prompt, model, schedule, authors, limits, destination, or enabled state in its organization-owned markdown resource.",
  schema: z.object({
    factoryId: factoryIdSchema,
    automationId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(120),
    displayName: z.string().trim().max(120).optional(),
    prompt: z.string().trim().min(1).max(20_000),
    model: z.string().trim().max(200).optional(),
    enabled: z.boolean(),
    slackWorkspace: z.enum(["primary", "secondary"]).optional(),
    slackChannelId: z.string().trim().max(128).optional(),
    slackChannelName: z.string().trim().max(200).optional(),
    repository: z.string().trim().max(512).optional(),
    sentryOrgSlug: z.string().trim().max(200).optional(),
    sentryProjectSlug: z.string().trim().max(200).optional(),
    sentryEnvironment: z.string().trim().max(200).optional(),
    authorMode: z.enum(["include", "exclude"]).optional(),
    authorIds: z.array(z.string().trim().min(1).max(32)).max(50).optional(),
    scheduleMode: z.enum(["interval", "daily"]).optional(),
    intervalMinutes: z
      .union([
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(30),
        z.literal(60),
      ])
      .optional(),
    dailyHour: z.number().int().min(0).max(23).optional(),
    dailyMinute: z.number().int().min(0).max(59).optional(),
    timezone: z.string().trim().max(80).optional(),
    inboxLimit: z.number().int().min(1).max(FACTORY_INBOX_LIMIT_MAX).optional(),
    workLimit: z.number().int().min(1).max(FACTORY_WORK_LIMIT_MAX).optional(),
  }),
  http: { method: "POST" },
  run: async (input, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const definition = await findFactoryAutomationDefinition(
      orgId,
      input.factoryId,
      input.automationId,
    );
    if (!definition) throw new Error("Factory automation not found.");
    if (definition.name !== input.name) {
      throw new Error(
        "Factory automation id and name do not refer to the same automation.",
      );
    }
    const resource = await resourceGetByPath(
      definition.resource.owner,
      definition.resource.path,
    );
    if (!resource) throw new Error("Factory automation not found.");
    const current = readFactoryAutomationConfig(resource.content, input.name);
    const authorMode = input.authorMode ?? current.authorMode;
    const authorIds = assertAuthorFilter(
      current.source,
      authorMode,
      current.source === "sentry" ? [] : (input.authorIds ?? current.authorIds),
    );
    const scheduleMode = input.scheduleMode ?? current.scheduleMode;
    const timezone =
      scheduleMode === "daily"
        ? input.timezone?.trim() || current.timezone
        : null;
    if (scheduleMode === "daily" && !timezone) {
      throw new Error("Choose a timezone for a daily schedule.");
    }
    const nextSlackChannelId =
      input.slackChannelId !== undefined
        ? input.slackChannelId.trim() || null
        : current.slackChannelId;
    const nextRepository =
      input.repository !== undefined
        ? input.repository.trim() || null
        : current.repository;
    const nextSentryOrgSlug =
      input.sentryOrgSlug !== undefined
        ? input.sentryOrgSlug.trim() || null
        : current.sentryOrgSlug;
    const nextSentryProjectSlug =
      input.sentryProjectSlug !== undefined
        ? input.sentryProjectSlug.trim() || null
        : current.sentryProjectSlug;
    if (input.enabled) {
      if (current.source === "slack" && !nextSlackChannelId) {
        throw new Error("Configure a Slack channel before saving this job.");
      }
      if (current.source === "github" && !nextRepository) {
        throw new Error(
          "Configure a GitHub repository before saving this job.",
        );
      }
      if (
        current.source === "sentry" &&
        (!nextSentryOrgSlug || !nextSentryProjectSlug)
      ) {
        throw new Error(
          "Configure Sentry organization and project slugs before saving this job.",
        );
      }
      try {
        await assertFactoryConnectorReady(current.source, userEmail, {
          orgId,
          slackWorkspace: input.slackWorkspace ?? current.slackWorkspace,
          verb: "saving",
        });
      } catch (error) {
        if (error instanceof VaultUnavailableError) fail(error.message);
        fail(
          error instanceof Error ? error.message : "Connector is not ready.",
        );
      }
    }
    const config = {
      ...current,
      slackWorkspace: input.slackWorkspace ?? current.slackWorkspace,
      slackChannelId: nextSlackChannelId,
      slackChannelName:
        input.slackChannelName !== undefined
          ? input.slackChannelName.trim() || null
          : current.slackChannelName,
      repository: nextRepository,
      sentryOrgSlug: nextSentryOrgSlug,
      sentryProjectSlug: nextSentryProjectSlug,
      sentryEnvironment:
        input.sentryEnvironment !== undefined
          ? input.sentryEnvironment.trim() || null
          : current.sentryEnvironment,
      authorMode,
      authorIds,
      scheduleMode,
      intervalMinutes: input.intervalMinutes ?? current.intervalMinutes,
      dailyHour: input.dailyHour ?? current.dailyHour,
      dailyMinute: input.dailyMinute ?? current.dailyMinute,
      timezone,
      inboxLimit: clampInboxLimit(input.inboxLimit ?? current.inboxLimit),
      workLimit: clampWorkLimit(
        input.workLimit ?? current.workLimit,
        current.source,
      ),
    };
    const schedule = scheduleCron(config);
    if (definition.meta.triggerType === "schedule" && !isValidCron(schedule)) {
      throw new Error(`Invalid cron expression "${schedule}".`);
    }
    let content = applyAutomationConfigFrontmatter(resource.content, config);
    content = replaceUserPrompt(content, input.prompt);
    content = setAutomationFrontmatterField(
      content,
      "enabled",
      input.enabled ? "true" : "false",
    );
    content = setAutomationFrontmatterField(
      content,
      "factoryId",
      input.factoryId,
    );
    if (input.model !== undefined) {
      content = setAutomationFrontmatterField(
        content,
        "model",
        input.model.trim() || "",
      );
    }
    if (input.displayName !== undefined) {
      content = setAutomationFrontmatterField(
        content,
        "displayName",
        input.displayName,
      );
    }
    if (definition.meta.triggerType === "schedule" && isValidCron(schedule)) {
      const nextRun = nextOccurrence(
        schedule,
        undefined,
        config.timezone ?? undefined,
      ).toISOString();
      content = setAutomationFrontmatterField(content, "nextRun", nextRun);
    }
    const updated = await resourcePutIfCurrent({
      owner: definition.resource.owner,
      path: definition.resource.path,
      content,
      mimeType: "text/markdown",
      expectedId: resource.id,
      expectedUpdatedAt: resource.updatedAt,
      expectedContent: resource.content,
    });
    if (!updated) {
      throw new Error(
        "Factory automation changed concurrently. Refresh and try again.",
      );
    }
    return {
      ok: true,
      id: definition.resource.id,
      name: definition.name,
      displayName: resolveAutomationDisplayName(definition.name, content),
      prompt: input.prompt,
      model: readAutomationModel(content),
      schedule: readAutomationSchedule(content),
      enabled: readAutomationEnabled(content),
      source: config.source,
      inboxLimit: config.inboxLimit,
      workLimit: config.workLimit,
    };
  },
});
