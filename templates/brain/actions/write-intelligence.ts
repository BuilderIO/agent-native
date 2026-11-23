import { defineAction } from "@agent-native/core/action";
import { EXPECTED_REVISION_DESCRIPTION } from "@agent-native/core/save-conflict/server";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { writeIntelligence } from "../server/lib/intelligence.js";
import {
  intelligenceEntitySchema,
  intelligenceItemSchema,
  intelligenceKindSchema,
  intelligenceStatusSchema,
  ownershipConfidenceSchema,
} from "../shared/intelligence.js";
import {
  evidenceSchema,
  parseJsonCliInput,
  publishTierSchema,
} from "./_schemas.js";

export default defineAction({
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Save an evidence-backed action item, decision, or customer feature request. Call write-intelligence one item at a time in sequence (never in parallel batches) with every required field populated. Copy exact quotes from get-capture; include cited owner, due date, entities and ownership confidence. If privacy redaction is required, use an exact email-free excerpt and omit email owners. AI extraction happens in agent chat.",
  schema: z.object({
    expectedRevision: z
      .string()
      .optional()
      .describe(
        `${EXPECTED_REVISION_DESCRIPTION} Required when updating id; read it from list-intelligence.`,
      ),
    id: z
      .string()
      .optional()
      .describe(
        "Existing intelligence knowledge ID to update; omit to create.",
      ),
    kind: intelligenceKindSchema.describe(
      "Record kind: action, decision, or feature-request.",
    ),
    title: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Concise statement supported by the evidence."),
    body: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .describe(
        "Source-grounded details, with uncertainty distinguished from fact.",
      ),
    owner: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .nullable()
      .optional()
      .describe("Owner name/email from the evidence; omit or null if unknown."),
    dueDate: z.iso
      .date()
      .nullable()
      .optional()
      .describe(
        "Due date whose YYYY-MM-DD value appears literally in an evidence quote; retain relative deadlines in body and omit this field when unresolved.",
      ),
    status: intelligenceStatusSchema
      .default("open")
      .describe("Lifecycle status: open (default), completed, or dismissed."),
    ownershipConfidence: ownershipConfidenceSchema
      .default("ambiguous")
      .describe(
        "Use explicit only when an evidence quote names the owner; defaults to ambiguous.",
      ),
    confidence: z.coerce
      .number()
      .int()
      .min(0)
      .max(100)
      .default(80)
      .describe(
        "Extraction confidence 0–100; not human verification. Defaults to 80.",
      ),
    entities: z
      .preprocess(
        parseJsonCliInput,
        z.array(intelligenceEntitySchema).max(30).default([]),
      )
      .describe(
        "Typed entities whose names appear in evidence quotes; defaults to none.",
      ),
    evidence: z
      .preprocess(
        parseJsonCliInput,
        z
          .array(evidenceSchema.extend({ quote: z.string().min(1).max(2000) }))
          .min(1)
          .max(20),
      )
      .describe(
        "One to twenty exact capture quotes; every evidence source must remain accessible.",
      )
      .nonoptional(),
    publishTier: publishTierSchema
      .optional()
      .describe(
        "private (default), team, or company; evidence audience restrictions always apply.",
      ),
  }),
  outputSchema: z.object({
    item: intelligenceItemSchema,
    postCommitWarnings: z.array(z.string()).optional(),
  }),
  link: ({ result }) => ({
    url: buildDeepLink({
      app: "brain",
      view: "intelligence",
      params: { intelligenceId: result.item.id },
    }),
    label: result.item.title,
  }),
  run: writeIntelligence,
});
