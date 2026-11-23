import { defineAction, fail } from "@agent-native/core/action";

import {
  dataStatusSchema,
  createDataStatusSchema,
  createDataStatusOutputSchema,
} from "../app/lib/model/data-status-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { createStatus } from "../server/model/statuses-store.js";

export default defineAction({
  description:
    "Create a status in the current workspace's shared catalogue. Workspace administrators can create labels; managers can apply existing labels.",
  schema: createDataStatusSchema,
  outputSchema: createDataStatusOutputSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input) => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current)) {
      fail("Only workspace admins can create statuses.", {
        statusCode: 403,
        errorCode: "data_status_admin_required",
      });
    }
    const status = await createStatus({
      ownerEmail: current.ownerEmail,
      orgId: current.orgId,
      name: input.name,
      color: input.color,
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.endorsed === undefined ? {} : { endorsed: input.endorsed }),
      ...(input.inLibrary === undefined ? {} : { inLibrary: input.inLibrary }),
      ...(input.enforcesReview === undefined
        ? {}
        : { enforcesReview: input.enforcesReview }),
    });
    return { status: dataStatusSchema.parse(status) };
  },
});
