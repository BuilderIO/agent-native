import { z } from "zod";

export const experienceProfilesConfig = z.object({
  referenceEmails: z.array(z.string().email()).default([]).meta({
    env: "EXPERIENCE_REFERENCE_EMAILS",
    doc: "Reviewers authorized to select the private reference experience. Empty denies reference access.",
  }),
});
