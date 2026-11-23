import { z } from "zod";

export const dataStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string().nullable(),
  endorsed: z.boolean(),
  inLibrary: z.boolean(),
  enforcesReview: z.boolean(),
  sortOrder: z.number(),
});

export const dataStatusesOutputSchema = z.object({
  statuses: z.array(dataStatusSchema),
  defaultStatusId: z.string().nullable(),
});
export const createDataStatusSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(4000).optional(),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, "Choose a valid color."),
    endorsed: z.boolean().optional(),
    inLibrary: z.boolean().optional(),
    enforcesReview: z.boolean().optional(),
  })
  .strict();
export const createDataStatusOutputSchema = z.object({
  status: dataStatusSchema,
});

export const deleteDataStatusSchema = z
  .object({
    id: z.string().trim().min(1),
  })
  .strict();

export const deleteDataStatusOutputSchema = z.object({
  removedId: z.string(),
});
export type DataStatus = z.infer<typeof dataStatusSchema>;
