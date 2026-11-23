import { z } from "zod";

export const personalPreferencesRevision = z
  .object({
    id: z.string(),
    updatedAt: z.number(),
  })
  .nullable();
export const personalPreferencesResult = z.object({
  content: z.string(),
  owner: z.string(),
  revision: personalPreferencesRevision,
});
export const personalPreferencesUpdate = z.object({
  content: z.string(),
  expectedOwner: z.string(),
  expectedRevision: personalPreferencesRevision,
});
export type PersonalPreferences = z.infer<typeof personalPreferencesResult>;
export type PersonalPreferencesUpdate = z.infer<
  typeof personalPreferencesUpdate
>;
