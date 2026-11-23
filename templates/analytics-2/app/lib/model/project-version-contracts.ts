import { z } from "zod";

/**
 * One saved version of a notebook. A version owns its own copy of the cells,
 * so the list is the project's history: the autosave in progress, published
 * versions and any named versions.
 */
export const projectVersionSchema = z.object({
  id: z.string().min(1),
  number: z.string(),
  kind: z.enum(["autosave", "published", "named"]),
  name: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string(),
  /** True for the version the editor is working in right now. */
  isWorking: z.boolean(),
  /** True for the version the published app reads from. */
  isPublished: z.boolean(),
});

export type ProjectVersion = z.infer<typeof projectVersionSchema>;

export const projectVersionListSchema = z.object({
  versions: z.array(projectVersionSchema),
});
