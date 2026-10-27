import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { decide } from "../decide.js";
import { DecideInputSchema } from "../validation.js";

const providerSchema = z.enum(["openai", "jev"]);
const decisionAnswerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("predicate"),
    name: z.string(),
    probability: z.number(),
  }),
  z.object({
    type: z.literal("choice"),
    name: z.string(),
    choice: z.string(),
    probabilities: z
      .array(z.object({ value: z.string(), probability: z.number() }))
      .optional(),
    confidence: z.number().optional(),
  }),
  z.object({
    type: z.literal("score"),
    name: z.string(),
    score: z.number(),
    levels: z.array(
      z.object({
        value: z.number(),
        label: z.string(),
        description: z.string(),
      }),
    ),
    probabilities: z
      .array(z.object({ value: z.number(), probability: z.number() }))
      .optional(),
    confidence: z.number().optional(),
  }),
]);
const decisionOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    provider: providerSchema,
    model: z.string(),
    answers: z.record(z.string(), decisionAnswerSchema),
    cached: z.boolean().optional(),
    usage: z
      .object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
      })
      .optional(),
  }),
  z.object({
    status: z.literal("not_configured"),
    reason: z.literal("missing_credentials"),
    providers: z.array(providerSchema),
  }),
  z.object({
    status: z.literal("failed"),
    reason: z.enum([
      "aborted",
      "timeout",
      "credentials_unavailable",
      "invalid_input",
      "unsupported_input",
      "unverified_capability",
      "provider_error",
      "invalid_response",
      "refusal",
    ]),
    provider: providerSchema.optional(),
    questionNames: z.array(z.string()).optional(),
  }),
]);

export default defineAction({
  description:
    "Make a read-only typed decision from text, JSON, or an image URL using the configured provider order. The Builder Jev proxy is verified for predicate, choice, and score questions. Returns keyed answers without executing the decision or changing app state.",
  schema: DecideInputSchema,
  outputSchema: decisionOutputSchema,
  readOnly: true,
  grounding: true,
  run: async (args, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    const options = args.options;
    return decide({
      ownerEmail: ctx.userEmail,
      input: args.input,
      questions: args.questions,
      options: {
        ...(options?.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.timeoutMs }),
        ...(options?.providers === undefined
          ? {}
          : { providers: options.providers }),
        ...(options?.cacheKey === undefined
          ? {}
          : { cacheKey: options.cacheKey }),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      },
    });
  },
});
