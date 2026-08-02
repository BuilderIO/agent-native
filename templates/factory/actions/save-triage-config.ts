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
    "Save Factory observation settings. This controls read-only Slack polling and repository metadata; it never starts an executor or changes a provider.",
  schema: z.object({
    slackWorkspace: workspaceSchema.default("primary"),
    slackChannelId: z.string().trim().min(1).max(128).optional(),
    slackChannelName: z.string().trim().max(200).optional(),
    pollingEnabled: z.boolean().default(false),
    repository: z.string().trim().max(256).optional(),
  }),
  http: { method: "POST" },
  run: async (
    {
      slackWorkspace,
      slackChannelId,
      slackChannelName,
      pollingEnabled,
      repository,
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
        repository: repository ?? null,
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
          repository: repository ?? null,
          updatedAt: now,
          ownerEmail: userEmail,
        },
      });
    return { ok: true, pollingEnabled, slackChannelId: slackChannelId ?? null };
  },
});
