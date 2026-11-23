import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  createDataCategoryResultSchema,
  dataCategoryColorSchema,
} from "../app/lib/model/data-resource-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { updateDataCategory } from "../server/model/data-resource-metadata.js";

export default defineAction({
  description:
    "Update a category in the current workspace's shared catalogue. Workspace administrators only.",
  schema: z
    .object({
      id: z.string().trim().min(1),
      name: z.string().trim().min(1).max(30),
      color: dataCategoryColorSchema,
      description: z.string().max(200).optional(),
    })
    .strict(),
  outputSchema: createDataCategoryResultSchema,
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id, ...patch }) => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current)) {
      fail("Only organisation owners and admins can manage categories.", {
        statusCode: 403,
        errorCode: "data_category_admin_required",
      });
    }
    const category = await updateDataCategory(
      { ownerEmail: current.ownerEmail, orgId: current.orgId },
      id,
      patch,
    );
    return { category };
  },
});
