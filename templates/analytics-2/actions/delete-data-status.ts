import { defineAction, fail } from "@agent-native/core/action";

import {
  deleteDataStatusOutputSchema,
  deleteDataStatusSchema,
} from "../app/lib/model/data-status-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { deleteStatus } from "../server/model/statuses-store.js";

export default defineAction({
  description:
    "Remove one status from the current workspace's shared catalogue. Projects that already carried it fall back to having no status. Workspace administrators only.",
  schema: deleteDataStatusSchema,
  outputSchema: deleteDataStatusOutputSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input) => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current)) {
      fail("Only workspace admins can remove statuses.", {
        statusCode: 403,
        errorCode: "data_status_admin_required",
      });
    }
    await deleteStatus(
      { ownerEmail: current.ownerEmail, orgId: current.orgId },
      input.id,
    );
    return { removedId: input.id };
  },
});
