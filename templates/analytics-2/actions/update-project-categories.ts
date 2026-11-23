import { defineAction } from "@agent-native/core/action";

import {
  updateProjectCategoriesResultSchema,
  updateProjectCategoriesSchema,
} from "../app/lib/model/project-category-contracts.js";
import { requireOwnedProject } from "../server/lib/project-action-access.js";
import { setProjectCategories } from "../server/model/project-categories.js";

export default defineAction({
  description:
    "Replace the categories a project carries with the given catalogue ids.",
  schema: updateProjectCategoriesSchema,
  outputSchema: updateProjectCategoriesResultSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ projectId, categoryIds }) => {
    const { scope, project } = await requireOwnedProject(projectId);
    return setProjectCategories(scope, project.id, categoryIds);
  },
});
