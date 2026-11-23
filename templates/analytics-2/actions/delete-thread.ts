import { NoWriteError, defineAction } from "@agent-native/core/action";
import { deleteThread, getThread } from "@agent-native/core/server";
import { z } from "zod";

import { workspaceChatScope } from "../app/lib/workspace-chat-scope.js";
import {
  currentApplicationId,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";

export default defineAction({
  mcpTool: true,
  needsApproval: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Delete a conversation you own in the active Analytics workspace.",
  schema: z.object({ threadId: z.string().min(1) }).strict(),
  outputSchema: z.object({ id: z.string(), deleted: z.literal(true) }),
  run: async ({ threadId }, context) => {
    const current = await requireCurrentWorkspace();
    const appId = currentApplicationId(context);
    const scope = workspaceChatScope(current.orgId, appId);
    const thread = await getThread(threadId);
    if (
      !thread ||
      thread.ownerEmail.toLowerCase() !== current.ownerEmail ||
      thread.orgId !== current.orgId ||
      thread.scope?.type !== scope.type ||
      thread.scope?.id !== scope.id
    ) {
      throw new NoWriteError(
        "Thread not found in the active Analytics workspace.",
        { errorCode: "not_found", statusCode: 404 },
      );
    }
    const deleted = await deleteThread(threadId, current.ownerEmail, {
      orgId: current.orgId,
      collapseEdits: true,
    });
    if (!deleted) {
      throw new NoWriteError(
        "Thread not found in the active Analytics workspace.",
        { errorCode: "not_found", statusCode: 404 },
      );
    }
    return { id: threadId, deleted: true as const };
  },
});
