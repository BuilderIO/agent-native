import { defineAction } from "@agent-native/core";
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
    "Write durable Brain knowledge. Evidence quotes must be exact substrings of captures; company-tier writes may become approval proposals.",
  schema: z.object({
    knowledgeId: z
      .string()
      .optional()
      .describe("Existing knowledge ID to update"),
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
      .describe("Existing knowledge item this entry replaces"),
    proposalMode: z.enum(["auto", "always", "never"]).default("auto"),
    rationale: z.string().optional(),
    redactions: z.preprocess(
      parseJsonCliInput,
      z.array(z.string()).default([]),
    ),
    publishCanonical: z.coerce
      .boolean()
      .default(false)
      .describe(
        "When true, mirror approved/published knowledge to context/company-brain/... workspace resources.",
      ),
  }),
  run: async (args) => writeKnowledgeRecord(args),
});
