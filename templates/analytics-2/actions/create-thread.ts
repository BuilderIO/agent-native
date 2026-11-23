import { defineAction } from "@agent-native/core/action";
import { createThread } from "@agent-native/core/server";
import { z } from "zod";

import { workspaceChatScope } from "../app/lib/workspace-chat-scope.js";
import {
  agentNavigationSchema,
  agentOpenIntentSchema,
  showAgentResource,
} from "../server/agent-navigation.js";
import {
  currentApplicationId,
  requireCurrentWorkspace,
  workspaceAccess,
} from "../server/lib/workspace-access.js";

export default defineAction({
  mcpTool: true,
  description: "Start a private data conversation in this app and workspace.",
  schema: z.object({ intent: agentOpenIntentSchema }).strict(),
  outputSchema: z.object({
    id: z.string().min(1),
    href: z.string().min(1),
    navigation: agentNavigationSchema.optional(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ intent }, context) => {
    const current = await requireCurrentWorkspace();
    await workspaceAccess.assertPermission(["create-thread"], {
      userEmail: current.ownerEmail,
      orgId: current.orgId,
    });
    const appId = currentApplicationId(context);
    const thread = await createThread(current.ownerEmail, {
      orgId: current.orgId,
      scope: workspaceChatScope(current.orgId, appId),
      source: { appId },
    });
    return {
      id: thread.id,
      href: `/thread/${encodeURIComponent(thread.id)}`,
      ...(await showAgentResource(context, "thread", thread.id, intent)),
    };
  },
});
