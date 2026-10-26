import { defineAction } from "@agent-native/core/action";
import {
  ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
  normalizeActionChangeResult,
} from "@agent-native/core/action-ui";
import {
  deleteWorkspaceConnection,
  getWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { assertWorkspaceConnectionDeleteManager } from "./connection-permissions.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
    idempotentHint: true,
  },
  description: "Delete a shared workspace integration connection.",
  chatUI: {
    renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
    when: (_args, result) => normalizeActionChangeResult(result) !== null,
    projectResult: (_args, result) => normalizeActionChangeResult(result),
  },
  schema: z.object({
    id: z.string().describe("Workspace connection ID to delete."),
  }),
  // It creates, changes, or revokes a credential or who may use one: every
  // call needs the user's approval, and "always allow" is not offered.
  needsApproval: true,
  allowPersistentApproval: false,
  run: async ({ id }, ctx) => {
    const connection = await getWorkspaceConnection(id);
    if (!connection) {
      throw new Error(`Workspace connection "${id}" was not found.`);
    }
    await assertWorkspaceConnectionDeleteManager(ctx, connection);
    const deleted = await deleteWorkspaceConnection(id);
    if (!deleted) {
      throw new Error(`Workspace connection "${id}" was not found.`);
    }
    return {
      id,
      deleted,
      change: {
        verb: "deleted",
        kind: "workspace-connection",
        title: connection.label.slice(0, 180),
        ...(connection.accountLabel
          ? { detail: connection.accountLabel.slice(0, 500) }
          : {}),
        url: "/settings/integrations",
      },
    };
  },
});
