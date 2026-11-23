import { z } from "zod";

import { dataCategorySchema } from "./data-resource-contracts.js";

/**
 * The project side of the organisation's category catalogue. Categories are
 * shared with the data surfaces (the original keeps one Category type for
 * both), so this contract re-uses the catalogue entry shape and only adds the
 * project-to-category assignment.
 */
export const projectCategoryAssignmentSchema = z.object({
  projectId: z.string().min(1),
  categoryIds: z.array(z.string().min(1)),
});

export type ProjectCategoryAssignment = z.infer<
  typeof projectCategoryAssignmentSchema
>;

export const projectCategoryListSchema = z.object({
  categories: z.array(dataCategorySchema),
  assignments: z.array(projectCategoryAssignmentSchema),
});

export const updateProjectCategoriesSchema = z
  .object({
    projectId: z.string().min(1),
    /** Explicit replacement of the project's whole category list. */
    categoryIds: z.array(z.string().min(1).max(200)).max(200),
  })
  .strict();

export const updateProjectCategoriesResultSchema =
  projectCategoryAssignmentSchema;
