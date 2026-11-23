import { z } from "zod";

export const projectFileSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  bytes: z.number(),
  createdAt: z.string(),
});
export type ProjectFile = z.infer<typeof projectFileSchema>;
export const storedProjectFileSchema = projectFileSchema.extend({
  ref: z.string().min(1),
  trashed: z.boolean().default(false),
});

export function projectFilePrefix(orgId: string, projectId: string) {
  return `project-files/${encodeURIComponent(orgId)}/${encodeURIComponent(projectId)}/`;
}
