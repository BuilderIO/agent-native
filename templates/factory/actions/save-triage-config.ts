import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

const workspaceSchema = z.enum(["primary", "secondary"]);

export default defineAction({
  description:
    "Save Factory observation and automation alert settings. Provider credentials live in shared workspace integrations; source routing metadata including the Builder Slack member id is stored on Factory config.",
  schema: z.object({
    slackWorkspace: workspaceSchema.optional(),
    slackChannelId: z.string().trim().max(128).optional(),
    slackChannelName: z.string().trim().max(200).optional(),
    builderSlackUserId: z
      .string()
      .trim()
      .max(32)
      .refine((value) => value === "" || /^[UW][A-Z0-9]+$/i.test(value), {
        message: "Builder Slack member id must look like U01234567.",
      })
      .optional(),
    pollingEnabled: z.boolean().optional(),
    githubPollingEnabled: z.boolean().optional(),
    sentryPollingEnabled: z.boolean().optional(),
    sentryOrgSlug: z.string().trim().max(200).optional(),
    sentryProjectSlug: z.string().trim().max(200).optional(),
    sentryEnvironment: z.string().trim().max(200).optional(),
    repository: z.string().trim().max(256).optional(),
    automationFailureAlertsEnabled: z.boolean().optional(),
    automationFailureAlertEmail: z
      .union([z.string().trim().email(), z.literal("")])
      .optional(),
  }),
  http: { method: "POST" },
  run: async (
    {
      slackWorkspace,
      slackChannelId,
      slackChannelName,
      builderSlackUserId,
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
    const existing = (
      await db
        .select()
        .from(triageConfig)
        .where(and(eq(triageConfig.id, orgId), eq(triageConfig.orgId, orgId)))
        .limit(1)
    )[0];
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
    const persistedSlackChannelName = persistText(
      slackChannelName,
      existing?.slackChannelName,
    );
    const persistedBuilderSlackUserId = persistText(
      builderSlackUserId === undefined
        ? undefined
        : builderSlackUserId.toUpperCase(),
      existing?.builderSlackUserId,
    );
    const persistedRepository = persistText(repository, existing?.repository);
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
    await db
      .insert(triageConfig)
      .values({
        id: orgId,
        slackWorkspace: persistedSlackWorkspace,
        slackChannelId: persistedSlackChannelId,
        slackChannelName: persistedSlackChannelName,
        builderSlackUserId: persistedBuilderSlackUserId,
        pollingEnabled: persistedPollingEnabled,
        githubPollingEnabled: persistedGithubPollingEnabled,
        sentryPollingEnabled: persistedSentryPollingEnabled,
        sentryOrgSlug: persistedSentryOrgSlug,
        sentryProjectSlug: persistedSentryProjectSlug,
        sentryEnvironment: persistedSentryEnvironment,
        repository: persistedRepository,
        automationFailureAlertsEnabled: persistedAutomationFailureAlertsEnabled,
        automationFailureAlertEmail: persistedAutomationFailureAlertEmail,
        createdAt: now,
        updatedAt: now,
        ownerEmail: userEmail,
        orgId,
      })
      .onConflictDoUpdate({
        target: triageConfig.id,
        set: {
          slackWorkspace: persistedSlackWorkspace,
          slackChannelId: persistedSlackChannelId,
          slackChannelName: persistedSlackChannelName,
          builderSlackUserId: persistedBuilderSlackUserId,
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
    return {
      ok: true,
      pollingEnabled: persistedPollingEnabled === 1,
      githubPollingEnabled: persistedGithubPollingEnabled === 1,
      sentryPollingEnabled: persistedSentryPollingEnabled === 1,
      slackChannelId: persistedSlackChannelId,
      builderSlackUserId: persistedBuilderSlackUserId,
      automationFailureAlertsEnabled:
        persistedAutomationFailureAlertsEnabled === 1,
      automationFailureAlertEmail: persistedAutomationFailureAlertEmail,
    };
  },
});
