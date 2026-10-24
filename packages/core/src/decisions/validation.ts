import { z } from "zod";

const InputPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("json"), value: z.unknown() }),
  z.object({
    type: z.literal("image"),
    url: z.url({ protocol: /^https?$/ }),
  }),
]);

const PredicateQuestionSchema = z.object({
  type: z.literal("predicate"),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  instructions: z.string().min(1).max(4_000),
});

const ChoiceQuestionSchema = z.object({
  type: z.literal("choice"),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  instructions: z.string().min(1).max(4_000),
  choices: z
    .array(
      z.object({
        value: z.string().min(1).max(256),
        description: z.string().min(1).max(2_000),
      }),
    )
    .min(2)
    .max(255),
});

const ScoreQuestionSchema = z.object({
  type: z.literal("score"),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  instructions: z.string().min(1).max(4_000),
  levels: z
    .array(
      z.object({
        label: z.string().min(1).max(256),
        description: z.string().min(1).max(2_000),
      }),
    )
    .min(2)
    .max(10),
});

export const DecideInputSchema = z.object({
  input: z.union([z.string(), z.array(InputPartSchema).min(1).max(32)]),
  questions: z
    .array(
      z.discriminatedUnion("type", [
        PredicateQuestionSchema,
        ChoiceQuestionSchema,
        ScoreQuestionSchema,
      ]),
    )
    .min(1)
    .max(8),
  options: z
    .object({
      timeoutMs: z.number().int().min(1_000).max(60_000).optional(),
      providers: z
        .array(z.enum(["openai", "jev"]))
        .min(1)
        .max(2)
        .optional(),
      cacheKey: z.string().min(1).max(256).optional(),
    })
    .optional(),
});

type JsonSerializationResult =
  | { status: "serialized"; json: string }
  | { status: "not_serializable"; cause: unknown };

function serializeJsonValue(value: unknown): JsonSerializationResult {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) {
      return {
        status: "not_serializable",
        cause: new TypeError("JSON input has no serialized representation."),
      };
    }
    return { status: "serialized", json };
  } catch (cause) {
    return { status: "not_serializable", cause };
  }
}

export function validateDecisionInput(value: unknown): boolean {
  const parsed = DecideInputSchema.safeParse(value);
  if (!parsed.success) return false;

  const questions = parsed.data.questions;
  if (new Set(questions.map(({ name }) => name)).size !== questions.length) {
    return false;
  }
  for (const question of questions) {
    if (
      question.type === "choice" &&
      new Set(question.choices.map(({ value }) => value)).size !==
        question.choices.length
    ) {
      return false;
    }
    if (
      question.type === "score" &&
      new Set(question.levels.map(({ label }) => label)).size !==
        question.levels.length
    ) {
      return false;
    }
  }

  for (const part of typeof parsed.data.input === "string"
    ? []
    : parsed.data.input) {
    if (part.type !== "json") continue;
    if (serializeJsonValue(part.value).status === "not_serializable") {
      return false;
    }
  }
  return true;
}
