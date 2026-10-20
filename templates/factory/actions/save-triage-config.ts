import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig } from "../server/db/schema.js";
import { isFactorySlackChannelConflict } from "../server/lib/factory-automation-plan.js";
import { readFactoryDefinition } from "../server/lib/factory-definitions.js";
import { DEFAULT_FACTORY_ID } from "../server/lib/factory-ids.js";
import {
  assertUniqueSlackChannelForFactory,
  factoryConfigRowId,
  factoryIdSchema,
  readTriageConfigRow,
} from "../server/lib/factory-scope.js";
import { persistGitHubRepository } from "../server/lib/github-repository.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
const workspaceSchema = z.enum(["primary", "secondary"]);

export default defineAction({
  description:
    "Save Factory observation and automation alert settings for the selected factory. Provider credentials live in shared workspace integrations; source routing metadata such as the Slack channel and repository is stored on Factory config.",
  schema: z.object({
    factoryId: factoryIdSchema.default(DEFAULT_FACTORY_ID),
    slackWorkspace: workspaceSchema.optional(),
    slackChannelId: z.string().trim().max(128).optional(),
    slackChannelName: z.string().trim().max(200).optional(),
    pollingEnabled: z.boolean().optional(),
    githubPollingEnabled: z.boolean().optional(),
    sentryPollingEnabled: z.boolean().optional(),
    sentryOrgSlug: z.string().trim().max(200).optional(),
    sentryProjectSlug: z.string().trim().max(200).optional(),
    sentryEnvironment: z.string().trim().max(200).optional(),
    repository: z.string().trim().max(512).optional(),
    automationFailureAlertsEnabled: z.boolean().optional(),
    automationFailureAlertEmail: z
      .union([z.string().trim().email(), z.literal("")])
      .optional(),
  }),
  http: { method: "POST" },
  // An upsert of one row per factory: a repeat writes the same values.
  retrySafe: true,
  run: async (
    {
      factoryId,
      slackWorkspace,
      slackChannelId,
      slackChannelName,
      pollingEnabled,
      githubPollingEnabled,
      sentryPollingEnabled,
      sentryOrgSlug,
      sentryProjectSlug,
      sentryEnvironment,
      repository,
      automationFailureAlertsEnabled,
      automationFailureAlertEmail,
    },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const now = new Date().toISOString();
    const db = getDb();
    if (factoryId !== DEFAULT_FACTORY_ID) {
      const factory = await readFactoryDefinition(orgId, factoryId);
      if (!factory) throw new Error("Factory not found.");
    }
    const existing = await readTriageConfigRow(db, orgId, factoryId);
    const persistText = (
      next: string | undefined,
      previous: string | null | undefined,
    ) => (next === undefined ? (previous ?? null) : next || null);
    const persistedSlackWorkspace =
      slackWorkspace ?? existing?.slackWorkspace ?? "primary";
    const persistedSlackChannelId = persistText(
      slackChannelId,
      existing?.slackChannelId,
    );
    await assertUniqueSlackChannelForFactory(
      db,
      orgId,
      factoryId,
      persistedSlackChannelId,
    );
    const persistedSlackChannelName = persistText(
      slackChannelName,
      existing?.slackChannelName,
    );
    const persistedRepository =
      repository === undefined
        ? persistGitHubRepository(existing?.repository)
        : persistGitHubRepository(repository);
    const persistedSentryOrgSlug = persistText(
      sentryOrgSlug,
      existing?.sentryOrgSlug,
    );
    const persistedSentryProjectSlug = persistText(
      sentryProjectSlug,
      existing?.sentryProjectSlug,
    );
    const persistedSentryEnvironment = persistText(
      sentryEnvironment,
      existing?.sentryEnvironment,
    );
    const persistedPollingEnabled =
      pollingEnabled === undefined
        ? (existing?.pollingEnabled ?? 0)
        : pollingEnabled
          ? 1
          : 0;
    const persistedGithubPollingEnabled =
      githubPollingEnabled === undefined
        ? (existing?.githubPollingEnabled ?? 0)
        : githubPollingEnabled
          ? 1
          : 0;
    const persistedSentryPollingEnabled =
      sentryPollingEnabled === undefined
        ? (existing?.sentryPollingEnabled ?? 0)
        : sentryPollingEnabled
          ? 1
          : 0;
    const persistedAutomationFailureAlertsEnabled =
      automationFailureAlertsEnabled === undefined
        ? (existing?.automationFailureAlertsEnabled ?? 1)
        : automationFailureAlertsEnabled
          ? 1
          : 0;
    const persistedAutomationFailureAlertEmail = persistText(
      automationFailureAlertEmail,
      existing?.automationFailureAlertEmail,
    );
    const configId = factoryConfigRowId(orgId, factoryId);
    try {
      await db
        .insert(triageConfig)
        .values({
          id: configId,
          factoryId,
          slackWorkspace: persistedSlackWorkspace,
          slackChannelId: persistedSlackChannelId,
          slackChannelName: persistedSlackChannelName,
          pollingEnabled: persistedPollingEnabled,
          githubPollingEnabled: persistedGithubPollingEnabled,
          sentryPollingEnabled: persistedSentryPollingEnabled,
          sentryOrgSlug: persistedSentryOrgSlug,
          sentryProjectSlug: persistedSentryProjectSlug,
          sentryEnvironment: persistedSentryEnvironment,
          repository: persistedRepository,
          automationFailureAlertsEnabled:
            persistedAutomationFailureAlertsEnabled,
          automationFailureAlertEmail: persistedAutomationFailureAlertEmail,
          createdAt: now,
          updatedAt: now,
          ownerEmail: userEmail,
          orgId,
        })
        .onConflictDoUpdate({
          target: triageConfig.id,
          set: {
            factoryId,
            slackWorkspace: persistedSlackWorkspace,
            slackChannelId: persistedSlackChannelId,
            slackChannelName: persistedSlackChannelName,
            pollingEnabled: persistedPollingEnabled,
            githubPollingEnabled: persistedGithubPollingEnabled,
            sentryPollingEnabled: persistedSentryPollingEnabled,
            sentryOrgSlug: persistedSentryOrgSlug,
            sentryProjectSlug: persistedSentryProjectSlug,
            sentryEnvironment: persistedSentryEnvironment,
            repository: persistedRepository,
            automationFailureAlertsEnabled:
              persistedAutomationFailureAlertsEnabled,
            automationFailureAlertEmail: persistedAutomationFailureAlertEmail,
            updatedAt: now,
            ownerEmail: userEmail,
          },
        });
    } catch (error) {
      if (isFactorySlackChannelConflict(error)) {
        throw new Error(
          "That Slack channel is already used by another Factory in this workspace.",
        );
      }
      throw error;
    }

    return {
      ok: true,
      factoryId,
      pollingEnabled: persistedPollingEnabled === 1,
      githubPollingEnabled: persistedGithubPollingEnabled === 1,
      sentryPollingEnabled: persistedSentryPollingEnabled === 1,
      slackChannelId: persistedSlackChannelId,
      automationFailureAlertsEnabled:
        persistedAutomationFailureAlertsEnabled === 1,
      automationFailureAlertEmail: persistedAutomationFailureAlertEmail,
    };
  },
});
