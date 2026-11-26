import { defineAction, isOutsideAgentCall } from "@agent-native/core/action";
import { EXPECTED_REVISION_DESCRIPTION } from "@agent-native/core/save-conflict/server";
import { z } from "zod";

import { writeKnowledgeRecord } from "../server/lib/brain.js";
import {
  entitySchema,
  evidenceSchema,
  knowledgeKindSchema,
  parseJsonCliInput,
  publishTierSchema,
} from "./_schemas.js";

export default defineAction({
  description:
    "Write durable Brain knowledge. Evidence quotes must be exact substrings of captures. An update replaces the whole record, so start it from the current record and send its revision.",
  schema: z
    .object({
      knowledgeId: z
        .string()
        .optional()
        .describe("Existing knowledge ID to update; omit to create."),
      expectedRevision: z
        .string()
        .optional()
        .describe(
          `${EXPECTED_REVISION_DESCRIPTION} Required with knowledgeId: read it as knowledge.revision from get-knowledge, list-knowledge or search-knowledge.`,
        ),
      kind: knowledgeKindSchema.default("fact"),
      title: z.string().min(1),
      body: z.string().min(1),
      summary: z.string().optional(),
      topic: z.string().nullable().optional(),
      tags: z.preprocess(parseJsonCliInput, z.array(z.string()).default([])),
      entities: z.preprocess(
        parseJsonCliInput,
        z.array(entitySchema).default([]),
      ),
      evidence: z.preprocess(
        parseJsonCliInput,
        z.array(evidenceSchema).default([]),
      ),
      confidence: z.coerce.number().int().min(0).max(100).default(80),
      publishTier: publishTierSchema.optional(),
      supersedesId: z
        .string()
        .optional()
        .describe(
          "Existing knowledge item this entry replaces; it is archived when this write saves.",
        ),
      supersedesRevision: z
        .string()
        .optional()
        .describe(
          `${EXPECTED_REVISION_DESCRIPTION} Required with supersedesId: the superseded record's revision, read as knowledge.revision from get-knowledge, list-knowledge or search-knowledge.`,
        ),
      rationale: z.string().optional(),
      redactions: z.preprocess(
        parseJsonCliInput,
        z.array(z.string()).default([]),
      ),
      publishCanonical: z.coerce
        .boolean()
        .default(false)
        .describe(
          "When true, mirror published knowledge to context/company-brain/... workspace resources.",
        ),
    })
    .superRefine((value, ctx) => {
      if (value.supersedesId && value.supersedesRevision === undefined)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["supersedesRevision"],
          message:
            "supersedesRevision is required with supersedesId: send the superseded record's revision.",
        });
    }),
  needsApproval: (args, ctx) =>
    isOutsideAgentCall(ctx) && args.publishCanonical === true,
  mcpTool: "search",
  run: async (args) => writeKnowledgeRecord(args),
});
