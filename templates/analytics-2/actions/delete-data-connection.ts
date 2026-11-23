import { defineAction } from "@agent-native/core/action";

import {
  deleteConnectionOutput,
  deleteConnectionSchema,
  deleteDataConnection,
} from "../server/model/data-connections.js";
export default defineAction({
  description:
    "Delete a workspace warehouse connection and the credential material it stored. Requires workspace management access.",
  schema: deleteConnectionSchema,
  outputSchema: deleteConnectionOutput,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
    idempotentHint: false,
  },
  // Removing a stored credential always needs the user's own confirmation
  // through the connection row's Confirm delete dialog, never a standing grant.
  needsApproval: true,
  allowPersistentApproval: false,
  // The original removes a connection only from its own settings surfaces, so
  // no agent, chat tool or MCP client gets this action.
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInChatHistory: false,
  persistInBrowser: false,
  run: deleteDataConnection,
});
