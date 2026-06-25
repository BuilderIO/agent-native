import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { previewKnowledgeCanonicalResource } from "../server/lib/brain.js";

const draftSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    summary: z.string().trim().max(5000).optional(),
    body: z.string().trim().min(1).max(20000).optional(),
  })
  .optional();

export default defineAction({
  description:
    "Preview the exact Markdown Brain would mirror to context/company-brain for a knowledge item or proposal.",
  schema: z
    .object({
      knowledgeId: z.string().min(1).optional(),
      proposalId: z.string().min(1).optional(),
      operation: z.enum(["publish", "unpublish"]).default("publish"),
      draft: draftSchema.describe(
        "Optional unsaved proposal wording to preview before approval.",
      ),
    })
    .refine(
      (value) => Boolean(value.knowledgeId) !== Boolean(value.proposalId),
      {
        message: "Provide exactly one of knowledgeId or proposalId.",
      },
    ),
  readOnly: true,
  run: async ({ knowledgeId, proposalId, operation, draft }) => ({
    preview: await previewKnowledgeCanonicalResource({
      knowledgeId,
      proposalId,
      operation,
      draft,
    }),
  }),
});
