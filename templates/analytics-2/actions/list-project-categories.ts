import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { projectCategoryListSchema } from "../app/lib/model/project-category-contracts.js";
import { requireReadableProject } from "../server/lib/project-action-access.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { readDataCategories } from "../server/model/data-resource-metadata.js";
import { readProjectCategories } from "../server/model/project-categories.js";

export default defineAction({
  description:
    "Read the workspace category catalogue and assignments. Pass projectId to read one accessible project, or omit it to list assignments for your own projects.",
  schema: z
    .object({
      projectId: z
        .string()
        .min(1)
        .optional()
        .describe("An accessible project ID."),
    })
    .strict(),
  outputSchema: projectCategoryListSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ projectId }) => {
    const { scope, project } =
      projectId === undefined
        ? { scope: await requireCurrentWorkspace(), project: undefined }
        : await requireReadableProject(projectId);
    const [catalogue, assignments] = await Promise.all([
      readDataCategories(scope),
      readProjectCategories(scope, project),
    ]);
    return { categories: catalogue.categories, assignments };
  },
});
