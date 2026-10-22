import type { JsonSchema } from "./subschemas.js";

/**
 * "Any JSON value" written as a union of concrete types, because OpenAI's
 * function validator behind the Builder gateway rejects a position with no
 * `type` ("schema must have a 'type' key") and Gemini's OpenAPI `parameters`
 * rejects an array with no `items`. It cannot recurse without `$ref`, which
 * the in-app Gemini adapter (`@ai-sdk/google`) does not translate, so array
 * items get one bounded level: nested arrays are not admitted. MCP advertises
 * the unbounded form below instead.
 */
const BOUNDED_JSON_VALUE_BRANCHES: readonly JsonSchema[] = [
  { type: "string" },
  { type: "number" },
  { type: "boolean" },
  { type: "null" },
  { type: "object", additionalProperties: true },
  {
    type: "array",
    items: {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
        { type: "object", additionalProperties: true },
      ],
    },
  },
];

const BOUNDED_JSON = JSON.stringify(BOUNDED_JSON_VALUE_BRANCHES);

export function boundedJsonValueBranches(): JsonSchema[] {
  return JSON.parse(BOUNDED_JSON) as JsonSchema[];
}

export function isBoundedJsonValueBranches(value: unknown): boolean {
  return Array.isArray(value) && JSON.stringify(value) === BOUNDED_JSON;
}

/** Writes "any JSON value" into a schema position that has no type. */
export type JsonValueWriter = (node: JsonSchema) => void;

export const writeBoundedJsonValue: JsonValueWriter = (node) => {
  node.anyOf = boundedJsonValueBranches();
};

/**
 * The unbounded "any JSON value" definition, for a root `$defs` entry that
 * `ref` points at. Anthropic, OpenAI and Gemini all accepted it (forced and
 * auto) through OpenRouter on 2026-10-07, and Codex keeps local `$defs`
 * references when it lowers MCP schemas.
 */
export function recursiveJsonValueDefinition(ref: string): JsonSchema {
  return {
    anyOf: [
      { type: "string" },
      { type: "number" },
      { type: "boolean" },
      { type: "null" },
      { type: "object", additionalProperties: true },
      { type: "array", items: { $ref: ref } },
    ],
  };
}
