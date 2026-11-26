import { z } from "zod";

import { PAGE_CHECK_SENTENCE_MAX_LENGTH } from "../shared/page-checks.js";

export const pageCheckSentenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(PAGE_CHECK_SENTENCE_MAX_LENGTH)
  .describe(
    'The check as one sentence of up to three parts, like "At most 120 words" or "At least 3 paragraphs. At most 12 sentences." For now, only counts can be read.',
  );

export const pageCheckScopeSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("page") }),
    z.object({ kind: z.literal("intro") }),
    z.object({
      kind: z.literal("section"),
      headingId: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe(
          "The heading's block ID, when known; otherwise the heading is found by its text and level",
        ),
      heading: z.string().trim().min(1).max(500).describe("Heading text"),
      level: z.number().int().min(1).max(6).describe("Heading level, 1-6"),
    }),
    z.object({ kind: z.literal("each_paragraph") }),
  ])
  .describe(
    "Where the check looks: the whole page, the intro (the text before the first heading), one section (a heading and everything below it), or every block of body text on its own",
  );

const unitSchema = z.enum(["words", "sentences", "paragraphs"]);
const findingSchema = z.enum(["fine", "not_fine", "couldnt"]);

const countPartSchema = z.object({
  kind: z.literal("count"),
  text: z.string(),
  unit: unitSchema,
  min: z.number().nullable(),
  max: z.number().nullable(),
});

const unreadPartSchema = z.object({
  kind: z.literal("unread"),
  text: z.string(),
});

const storedScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page") }),
  z.object({ kind: z.literal("intro") }),
  z.object({
    kind: z.literal("section"),
    headingId: z.string().nullable(),
    heading: z.string(),
    level: z.number(),
  }),
  z.object({ kind: z.literal("each_paragraph") }),
]);

const partResultSchema = z.object({
  finding: findingSchema,
  count: z.number().optional(),
  reason: z.literal("section_deleted").optional(),
});

const resultSchema = z.object({
  placeKey: z.string(),
  wordingHash: z.string(),
  textHash: z.string(),
  finding: findingSchema,
  parts: z.array(partResultSchema),
  checkedBy: z.string(),
  checkedAt: z.string(),
});

const answerSchema = z.object({
  key: z.string(),
  place: z
    .object({
      key: z.string(),
      path: z.string(),
      blockId: z.string().nullable(),
      textHash: z.string(),
      excerpt: z.string(),
    })
    .nullable(),
  answer: z.enum(["fine", "not_fine", "skipped", "changed", "couldnt"]),
  result: resultSchema.nullable(),
  reason: z.literal("section_deleted").optional(),
});

const checkSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  sentence: z.string(),
  parts: z.array(countPartSchema),
  scope: storedScopeSchema,
  wordingHash: z.string(),
  paused: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  answers: z.array(answerSchema),
  skips: z.array(z.object({ placeKey: z.string(), textHash: z.string() })),
});

export const pageChecksOutput = z.object({
  documentId: z.string(),
  canEdit: z.boolean(),
  checks: z.array(checkSchema),
});

export const pageCheckAddedOutput = pageChecksOutput.extend({
  checkId: z.string(),
});

export const pageCheckTryOutput = z.object({
  reading: z.object({
    parts: z.array(z.union([countPartSchema, unreadPartSchema])),
    tooManyParts: z.boolean(),
  }),
  answers: z.array(answerSchema).nullable(),
});

export const PAGE_CHECK_ANSWERS_HELP =
  "Each check lists its answers, one per place it looks at: fine; not_fine (with each part's count); skipped (someone chose to leave that text alone until it changes); changed (the text or the check changed since it was last checked, and run-page-checks checks it again); couldnt (with a reason, like section_deleted).";
