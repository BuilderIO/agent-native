import { defineAction } from "@agent-native/core/action";
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
    "Save Factory source settings. This controls Slack, GitHub, and Sentry polling; organization automations decide when governed provider work may start.",
  schema: z.object({
    slackWorkspace: workspaceSchema.default("primary"),
    slackChannelId: z.string().trim().min(1).max(128).optional(),
    slackChannelName: z.string().trim().max(200).optional(),
    pollingEnabled: z.boolean().default(false),
    githubPollingEnabled: z.boolean().default(false),
    sentryPollingEnabled: z.boolean().default(false),
    sentryOrgSlug: z.string().trim().max(200).optional(),
    sentryProjectSlug: z.string().trim().max(200).optional(),
    sentryEnvironment: z.string().trim().max(200).optional(),
    repository: z.string().trim().max(256).optional(),
    automationFailureAlertsEnabled: z.boolean().default(true),
    automationFailureAlertEmail: z.string().trim().email().optional(),
  }),
  http: { method: "POST" },
  run: async (
    {
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
    await db
      .insert(triageConfig)
      .values({
        id: orgId,
        slackWorkspace,
        slackChannelId: slackChannelId ?? null,
        slackChannelName: slackChannelName ?? null,
        pollingEnabled: pollingEnabled ? 1 : 0,
        githubPollingEnabled: githubPollingEnabled ? 1 : 0,
        sentryPollingEnabled: sentryPollingEnabled ? 1 : 0,
        sentryOrgSlug: sentryOrgSlug ?? null,
        sentryProjectSlug: sentryProjectSlug ?? null,
        sentryEnvironment: sentryEnvironment ?? null,
        repository: repository ?? null,
        automationFailureAlertsEnabled: automationFailureAlertsEnabled ? 1 : 0,
        automationFailureAlertEmail: automationFailureAlertEmail ?? null,
        createdAt: now,
        updatedAt: now,
        ownerEmail: userEmail,
        orgId,
      })
      .onConflictDoUpdate({
        target: triageConfig.id,
        set: {
          slackWorkspace,
          slackChannelId: slackChannelId ?? null,
          slackChannelName: slackChannelName ?? null,
          pollingEnabled: pollingEnabled ? 1 : 0,
          githubPollingEnabled: githubPollingEnabled ? 1 : 0,
          sentryPollingEnabled: sentryPollingEnabled ? 1 : 0,
          sentryOrgSlug: sentryOrgSlug ?? null,
          sentryProjectSlug: sentryProjectSlug ?? null,
          sentryEnvironment: sentryEnvironment ?? null,
          repository: repository ?? null,
          automationFailureAlertsEnabled: automationFailureAlertsEnabled
            ? 1
            : 0,
          automationFailureAlertEmail: automationFailureAlertEmail ?? null,
          updatedAt: now,
          ownerEmail: userEmail,
        },
      });
    return {
      ok: true,
      pollingEnabled,
      githubPollingEnabled,
      sentryPollingEnabled,
      slackChannelId: slackChannelId ?? null,
      automationFailureAlertsEnabled,
      automationFailureAlertEmail: automationFailureAlertEmail ?? null,
    };
  },
});
