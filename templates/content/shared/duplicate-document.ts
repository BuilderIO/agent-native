import { z } from "zod";

export const duplicateDocumentResultSchema = z.object({
  id: z.string().min(1),
  sourceDocumentId: z.string().min(1),
  duplicatedCount: z.number().int().positive(),
  documentIds: z
    .array(z.object({ sourceId: z.string().min(1), id: z.string().min(1) }))
    .min(1),
  replayed: z.boolean(),
  placement: z.literal("root"),
  visibility: z.literal("private"),
  spaceId: z.string().min(1),
});

export type DuplicateDocumentResult = z.infer<
  typeof duplicateDocumentResultSchema
>;
