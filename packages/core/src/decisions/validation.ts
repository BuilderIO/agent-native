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

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function cloneJsonValue(value: unknown, ancestors: WeakSet<object>): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON input contains a non-finite number.");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("JSON input contains a non-JSON value.");
  }
  if (ancestors.has(value)) {
    throw new TypeError("JSON input contains a cycle.");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError(
          "JSON input contains an array with a custom prototype.",
        );
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      const length = lengthDescriptor?.value;
      if (
        !lengthDescriptor ||
        lengthDescriptor.enumerable ||
        !Number.isInteger(length) ||
        length < 0
      ) {
        throw new TypeError("JSON input contains an invalid array.");
      }

      const indices = new Set<number>();
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") {
          throw new TypeError("JSON input contains a symbol property.");
        }
        if (key === "length") continue;
        const index = Number(key);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= length ||
          String(index) !== key
        ) {
          throw new TypeError("JSON input contains an extra array property.");
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError("JSON input contains a non-data array property.");
        }
        indices.add(index);
      }
      if (indices.size !== length) {
        throw new TypeError("JSON input contains a sparse array.");
      }

      const output: JsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor || !("value" in descriptor)) {
          throw new TypeError("JSON input contains a sparse array.");
        }
        output.push(cloneJsonValue(descriptor.value, ancestors));
      }
      return output;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        "JSON input contains an object with a custom prototype.",
      );
    }
    const output: { [key: string]: JsonValue } = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new TypeError("JSON input contains a symbol property.");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("JSON input contains a non-data object property.");
      }
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: cloneJsonValue(descriptor.value, ancestors),
        writable: true,
      });
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function serializeJsonValue(value: unknown): JsonSerializationResult {
  try {
    const json = JSON.stringify(cloneJsonValue(value, new WeakSet()));
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
