import { defineAction, isOutsideAgentCall } from "@agent-native/core/action";
import { EXPECTED_REVISION_DESCRIPTION } from "@agent-native/core/save-conflict/server";
import { z } from "zod";

import { setKnowledgeCanonicalResource } from "../server/lib/brain.js";
import { booleanishSchema } from "./_schemas.js";

export default defineAction({
  description:
    "Publish or unpublish an approved Brain knowledge item as canonical Dispatch workspace context under context/company-brain/. Send the revision of the record you reviewed.",
  schema: z.object({
    knowledgeId: z.string().min(1),
    expectedRevision: z
      .string()
      .optional()
      .describe(
        `${EXPECTED_REVISION_DESCRIPTION} Read it as knowledge.revision from get-knowledge, list-knowledge or search-knowledge, or as preview.revision from preview-canonical-resource.`,
      ),
    published: booleanishSchema
      .default(true)
      .describe(
        "True mirrors the knowledge item to workspace context; false removes Brain's mirrored resource path.",
      ),
  }),
  needsApproval: (_args, ctx) => isOutsideAgentCall(ctx),
  mcpTool: "search",
  run: async ({ knowledgeId, published, expectedRevision }) => {
    const { postCommitWarnings, ...knowledge } =
      await setKnowledgeCanonicalResource(
        knowledgeId,
        published,
        expectedRevision,
      );
    return {
      published,
      knowledge,
      ...(postCommitWarnings ? { postCommitWarnings } : {}),
    };
  },
});
