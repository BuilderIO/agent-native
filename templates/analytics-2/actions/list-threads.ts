import { defineAction } from "@agent-native/core/action";
import { listThreads } from "@agent-native/core/server";
import { z } from "zod";

import { workspaceChatScope } from "../app/lib/workspace-chat-scope.js";
import {
  currentApplicationId,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";

const PAGE_SIZE_MAX = 100;

export default defineAction({
  mcpTool: true,
  description:
    "List the conversations you own in the active Analytics workspace, newest first. Check hasMore and page with offset.",
  schema: z
    .object({
      limit: z.number().int().min(1).max(PAGE_SIZE_MAX).default(50),
      offset: z.number().int().min(0).default(0),
      includeArchived: z.boolean().default(false),
    })
    .strict(),
  outputSchema: z.object({
    threads: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        preview: z.string(),
        messageCount: z.number(),
        createdAt: z.number(),
        updatedAt: z.number(),
        archivedAt: z.number().nullable(),
      }),
    ),
    hasMore: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ limit, offset, includeArchived }, context) => {
    const current = await requireCurrentWorkspace();
    const appId = currentApplicationId(context);
    const rows = await listThreads(current.ownerEmail, {
      orgId: current.orgId,
      ownership: "mine",
      includeExternal: false,
      sourceAppId: appId,
      scope: workspaceChatScope(current.orgId, appId),
      includeArchived,
      collapseEdits: true,
      limit: limit + 1,
      offset,
    });
    return {
      threads: rows.slice(0, limit).map((thread) => ({
        id: thread.id,
        title: thread.title,
        preview: thread.preview,
        messageCount: thread.messageCount,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        archivedAt: thread.archivedAt ?? null,
      })),
      hasMore: rows.length > limit,
    };
  },
});
