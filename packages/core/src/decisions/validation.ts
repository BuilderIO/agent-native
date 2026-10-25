import { z } from "zod";

export const MAX_DECISION_PAYLOAD_BYTES = 256 * 1024;
const DECISION_PAYLOAD_ENVELOPE_BYTES =
  '{"input":null,"questions":null}'.length - 2 * "null".length;

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
  | { status: "not_serializable"; cause: unknown }
  | { status: "too_large" };

type PayloadBudget = { usedBytes: number };

class DecisionPayloadTooLargeError extends Error {}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function consumePayloadBytes(budget: PayloadBudget, bytes: number): void {
  if (budget.usedBytes + bytes > MAX_DECISION_PAYLOAD_BYTES) {
    throw new DecisionPayloadTooLargeError();
  }
  budget.usedBytes += bytes;
}

function consumeJsonString(value: string, budget: PayloadBudget): void {
  if (value.length + 2 > MAX_DECISION_PAYLOAD_BYTES - budget.usedBytes) {
    throw new DecisionPayloadTooLargeError();
  }
  consumePayloadBytes(budget, serializedStringBytes(value));
}

function serializedStringBytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function cloneJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
  budget: PayloadBudget,
): JsonValue {
  if (value === null) {
    consumePayloadBytes(budget, 4);
    return value;
  }
  if (typeof value === "string") {
    consumeJsonString(value, budget);
    return value;
  }
  if (typeof value === "boolean") {
    consumePayloadBytes(budget, value ? 4 : 5);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON input contains a non-finite number.");
    }
    consumePayloadBytes(budget, String(value).length);
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
      consumePayloadBytes(budget, 2 + Math.max(0, length - 1));

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
        output.push(cloneJsonValue(descriptor.value, ancestors, budget));
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
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("JSON input contains a symbol property.");
    }
    consumePayloadBytes(budget, 2 + Math.max(0, keys.length - 1));
    for (const key of keys) {
      if (typeof key !== "string") {
        throw new TypeError("JSON input contains a symbol property.");
      }
      consumeJsonString(key, budget);
      consumePayloadBytes(budget, 1);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("JSON input contains a non-data object property.");
      }
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: cloneJsonValue(descriptor.value, ancestors, budget),
        writable: true,
      });
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function serializeJsonValue(
  value: unknown,
  budget: PayloadBudget,
): JsonSerializationResult {
  try {
    const json: unknown = JSON.stringify(
      cloneJsonValue(value, new WeakSet(), budget),
    );
    if (typeof json !== "string") {
      return {
        status: "not_serializable",
        cause: new TypeError("JSON input has no serialized representation."),
      };
    }
    return { status: "serialized", json };
  } catch (cause) {
    if (cause instanceof DecisionPayloadTooLargeError) {
      return { status: "too_large" };
    }
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

  const budget = { usedBytes: DECISION_PAYLOAD_ENVELOPE_BYTES };
  return (
    serializeJsonValue(parsed.data.input, budget).status === "serialized" &&
    serializeJsonValue(parsed.data.questions, budget).status === "serialized"
  );
}
