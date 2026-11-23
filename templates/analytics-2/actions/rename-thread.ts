import { NoWriteError, defineAction, fail } from "@agent-native/core/action";
import { renameThread } from "@agent-native/core/chat-threads/store";
import { getThread } from "@agent-native/core/server";
import { z } from "zod";

import { workspaceChatScope } from "../app/lib/workspace-chat-scope.js";
import {
  agentNavigationSchema,
  showAgentResource,
} from "../server/agent-navigation.js";
import {
  currentApplicationId,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";

export default defineAction({
  mcpTool: true,
  description:
    "Rename a conversation you own in the active Analytics workspace.",
  schema: z
    .object({
      threadId: z.string().min(1),
      title: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .transform((value) => value.replace(/\s+/g, " ")),
    })
    .strict(),
  outputSchema: z.object({
    id: z.string(),
    title: z.string(),
    navigation: agentNavigationSchema.optional(),
  }),
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ threadId, title }, context) => {
    const current = await requireCurrentWorkspace();
    const scope = workspaceChatScope(
      current.orgId,
      currentApplicationId(context),
    );
    const thread = await getThread(threadId);
    if (
      !thread ||
      thread.ownerEmail.toLowerCase() !== current.ownerEmail ||
      thread.orgId !== current.orgId ||
      thread.scope?.type !== scope.type ||
      thread.scope.id !== scope.id
    ) {
      throw new NoWriteError(
        "Thread not found in the active Analytics workspace.",
        { errorCode: "not_found", statusCode: 404 },
      );
    }
    const renamed = await renameThread(threadId, title, {
      ownerEmail: current.ownerEmail,
      orgId: current.orgId,
      collapseEdits: true,
    });
    if (!renamed)
      throw new NoWriteError(
        "Thread not found in the active Analytics workspace.",
        { errorCode: "not_found", statusCode: 404 },
      );
    const updated = await getThread(threadId);
    if (!updated || updated.title !== title) {
      fail(
        "The rename could not be verified. Refresh the thread before retrying.",
        { errorCode: "rename_unverified", statusCode: 500 },
      );
    }
    return {
      id: threadId,
      title: updated.title,
      ...(await showAgentResource(context, "thread", threadId)),
    };
  },
});
