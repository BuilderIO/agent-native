import { defineAction, fail } from "@agent-native/core/action";

import {
  deleteDataCategoryResultSchema,
  deleteDataCategorySchema,
} from "../app/lib/model/data-resource-contracts.js";
import {
  currentWorkspaceCapabilities,
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { deleteDataCategory } from "../server/model/data-resource-metadata.js";
import { clearCategoryAssignments } from "../server/model/project-categories.js";

export default defineAction({
  description:
    "Remove one organisation-wide data category from the catalogue and from every project that carried it. Requires organisation owner or admin access; an unknown id is a 404.",
  schema: deleteDataCategorySchema,
  outputSchema: deleteDataCategoryResultSchema,
  http: { method: "POST" },
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input) => {
    const current = await requireCurrentWorkspace();
    const capabilities = await currentWorkspaceCapabilities(current);
    if (!capabilities.isManagerOrAbove) {
      fail("Only workspace managers can manage categories.", {
        statusCode: 403,
        errorCode: "data_category_manager_required",
      });
    }
    if (!isWorkspaceAdministrator(current)) {
      fail("Only organisation owners and admins can manage categories.", {
        statusCode: 403,
        errorCode: "data_category_admin_required",
      });
    }
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    const removed = await deleteDataCategory(scope, input.id);
    await clearCategoryAssignments(scope, removed.removedId);
    return removed;
  },
});
