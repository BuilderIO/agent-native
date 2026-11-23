import { defineAction, fail } from "@agent-native/core/action";

import {
  createDataCategoryResultSchema,
  createDataCategorySchema,
} from "../app/lib/model/data-resource-contracts.js";
import {
  currentWorkspaceCapabilities,
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { createDataCategory } from "../server/model/data-resource-metadata.js";

export default defineAction({
  description:
    "Create one organisation-wide data category. Requires organisation owner or admin access; a duplicate name is a 409 conflict and the catalogue is capped.",
  schema: createDataCategorySchema,
  outputSchema: createDataCategoryResultSchema,
  http: { method: "POST" },
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
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
    // The catalogue is organisation settings, which only an organisation
    // owner/admin administers. A delegated app manager may edit annotations
    // but does not thereby become a catalogue administrator.
    if (!isWorkspaceAdministrator(current)) {
      fail("Only organisation owners and admins can manage categories.", {
        statusCode: 403,
        errorCode: "data_category_admin_required",
      });
    }
    const category = await createDataCategory(
      { ownerEmail: current.ownerEmail, orgId: current.orgId },
      input,
    );
    return { category };
  },
});
