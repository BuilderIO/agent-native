import { z } from "zod";

import {
  PAGE_CHECK_HEADING_MAX_LENGTH,
  PAGE_CHECK_HEADING_OPS,
  PAGE_CHECK_MAX_PARTS,
  PAGE_CHECK_QUESTION_MAX_LENGTH,
  PAGE_CHECK_SENTENCE_MAX_LENGTH,
} from "../shared/page-checks.js";

export const pageCheckSentenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(PAGE_CHECK_SENTENCE_MAX_LENGTH)
  .describe(
    'The check as one sentence of up to three parts, like "At most 120 words" or "At most 12 sentences. Opens with a question." A count of words, sentences or paragraphs is read as a count; any other part becomes a yes/no question a decision model answers about the text.',
  );

const onlyWhereSchema = z
  .discriminatedUnion("field", [
    z.object({
      field: z.literal("heading"),
      op: z.enum(PAGE_CHECK_HEADING_OPS),
      text: z.string().trim().min(1).max(PAGE_CHECK_HEADING_MAX_LENGTH),
    }),
    z.object({
      field: z.literal("level"),
      level: z.number().int().min(1).max(6),
    }),
  ])
  .optional()
  .describe(
    "Narrows the places to those whose heading matches, ignoring case: a section's own heading, or for a paragraph the heading it sits under. Leave it out to check every one.",
  );

const storedOnlyWhereSchema = z
  .discriminatedUnion("field", [
    z.object({
      field: z.literal("heading"),
      op: z.enum(PAGE_CHECK_HEADING_OPS),
      text: z.string(),
    }),
    z.object({ field: z.literal("level"), level: z.number() }),
  ])
  .optional();

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
      heading: z
        .string()
        .trim()
        .min(1)
        .max(PAGE_CHECK_HEADING_MAX_LENGTH)
        .describe("Heading text"),
      level: z.number().int().min(1).max(6).describe("Heading level, 1-6"),
    }),
    z.object({ kind: z.literal("each_section"), only: onlyWhereSchema }),
    z.object({ kind: z.literal("each_paragraph"), only: onlyWhereSchema }),
  ])
  .describe(
    "Where the check looks: the whole page, the intro (the text before the first heading), one section (a heading and everything below it), each section on its own, or every block of body text on its own. Each section and each paragraph can be narrowed with only.",
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

const questionPartSchema = z.object({
  kind: z.literal("question"),
  text: z.string(),
  question: z.string().describe("The yes/no question the model is asked"),
  passes: z
    .enum(["yes", "no"])
    .describe("The answer that means the text passes"),
  decider: z
    .enum(["jev", "openai"])
    .describe("The one decision model this part ever asks"),
});

const partSchema = z.discriminatedUnion("kind", [
  countPartSchema,
  questionPartSchema,
]);

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
  z.object({ kind: z.literal("each_section"), only: storedOnlyWhereSchema }),
  z.object({ kind: z.literal("each_paragraph"), only: storedOnlyWhereSchema }),
]);

const couldntReasonSchema = z.enum([
  "section_deleted",
  "no_model",
  "model_failed",
  "daily_limit",
]);

const partResultSchema = z.object({
  finding: findingSchema,
  count: z.number().optional(),
  passing: z.number().optional(),
  reason: couldntReasonSchema.optional(),
});

const sureSchema = z.enum(["sure", "balanced", "more"]);

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
  reason: couldntReasonSchema.optional(),
});

const checkSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  sentence: z.string(),
  parts: z.array(partSchema),
  scope: storedScopeSchema,
  wordingHash: z.string(),
  sure: sureSchema,
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

export const pageCheckQuestionsSchema = z
  .array(
    z.object({
      text: z
        .string()
        .trim()
        .min(1)
        .describe("The part, as the sentence has it"),
      question: z.string().trim().min(1).max(PAGE_CHECK_QUESTION_MAX_LENGTH),
      passes: z
        .enum(["yes", "no"])
        .describe("The answer that means the text passes"),
    }),
  )
  .max(PAGE_CHECK_MAX_PARTS)
  .optional()
  .describe(
    "A yes/no part's question, when the person wrote or edited it. A part left out gets one written by the workspace's AI model.",
  );

export const pageCheckSureSchema = sureSchema
  .optional()
  .describe(
    "How sure a yes/no answer must be before it marks text: sure marks only clear misses, balanced (the default) likely ones, more catches more at the cost of some false marks. Changing it never asks the model again.",
  );

export const pageCheckTryOutput = z.object({
  reading: z.object({
    parts: z.array(z.union([countPartSchema, unreadPartSchema])),
    tooManyParts: z.boolean(),
  }),
  parts: z.array(partSchema).nullable(),
  answers: z.array(answerSchema).nullable(),
  problem: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("unreadable"), tooManyParts: z.boolean() }),
      z.object({
        kind: z.literal("vague"),
        text: z.string(),
        examples: z.tuple([z.string(), z.string()]),
      }),
      z.object({ kind: z.literal("unwritten"), texts: z.array(z.string()) }),
      z.object({ kind: z.literal("no_model") }),
    ])
    .nullable(),
  decider: z
    .object({
      provider: z.enum(["jev", "openai"]),
      model: z.string(),
      company: z.string(),
    })
    .nullable()
    .describe("Who reads the page's text to answer the yes/no parts"),
});

export const PAGE_CHECK_ANSWERS_HELP =
  "Each check lists its answers, one per place it looks at: fine; not_fine (with each count part's count, and each yes/no part's chance of passing from 0 to 1); skipped (someone chose to leave that text alone until it changes); changed (the text or the check changed since it was last checked, and run-page-checks checks it again); couldnt (with a reason: section_deleted, no_model, model_failed or daily_limit).";
