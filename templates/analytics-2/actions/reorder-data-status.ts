import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { dataStatusSchema } from "../app/lib/model/data-status-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { reorderStatuses } from "../server/model/statuses-store.js";

export default defineAction({
  description:
    "Reorder the complete workspace status catalogue. Workspace administrators only.",
  schema: z.object({ ids: z.array(z.string().trim().min(1)) }).strict(),
  outputSchema: z.object({ statuses: z.array(dataStatusSchema) }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ ids }) => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current)) {
      fail("Only workspace admins can reorder statuses.", {
        statusCode: 403,
        errorCode: "data_status_admin_required",
      });
    }
    const statuses = await reorderStatuses(
      { ownerEmail: current.ownerEmail, orgId: current.orgId },
      ids,
    );
    return {
      statuses: statuses.map((status) => dataStatusSchema.parse(status)),
    };
  },
});
