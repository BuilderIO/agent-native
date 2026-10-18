import {
  isJsonSchemaObject,
  walkSubschemas,
  type JsonSchema,
} from "./subschemas.js";

/**
 * A schema the provider rewriters cannot carry over without changing what it
 * accepts. Callers refuse it, or report the tool that holds it as unusable,
 * instead of advertising a contract the source never declared.
 */
export class UnusableSchemaError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`JSON schema ${reason} at ${path || "/"}.`);
    this.name = "UnusableSchemaError";
  }
}

// An empty `allOf` constrains nothing, so it is not on this list.
const CHOICE_KEYWORDS = ["enum", "anyOf", "oneOf"] as const;

/**
 * Throws for an empty `enum`, `anyOf` or `oneOf`, each of which accepts no
 * value. No rewrite keeps that meaning: a position is typed from its `enum`
 * values, so one with none would reach the provider with no type, which the
 * pinned provider rules refuse, and the flattener widens a root composition
 * with no branches to an unconstrained object.
 */
export function assertNoEmptyChoices(schema: object): void {
  walkSubschemas(schema as JsonSchema, (node, pointer) => {
    if (!isJsonSchemaObject(node)) return;
    for (const keyword of CHOICE_KEYWORDS) {
      const choices = node[keyword];
      if (!Array.isArray(choices) || choices.length > 0) continue;
      throw new UnusableSchemaError(
        pointer,
        `declares an empty ${keyword}, so it accepts no value`,
      );
    }
  });
}

/** JSON equality, where object key order does not matter. */
function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJsonValue(item, b[index]))
    );
  }
  if (!isJsonSchemaObject(a) || !isJsonSchemaObject(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJsonValue(a[key], b[key]))
  );
}

/**
 * Throws for a `const` its own `enum` does not list. That position accepts no
 * value, and advertising either keyword alone would accept one: the in-app
 * copy drops an `enum` Gemini cannot hold and keeps the `const`.
 */
export function assertConstInEnum(schema: object): void {
  walkSubschemas(schema as JsonSchema, (node, pointer) => {
    if (!isJsonSchemaObject(node) || node.const === undefined) return;
    if (!Array.isArray(node.enum)) return;
    if (node.enum.some((value) => sameJsonValue(value, node.const))) return;
    throw new UnusableSchemaError(
      pointer,
      "declares a const its enum does not list, so it accepts no value",
    );
  });
}

/**
 * `convert(entry.tool.parameters)`, or the `UnusableSchemaError` that leaves
 * the action out of a tool list: the one `defineAction` found in the source
 * schema, which stripping can hide from the parameters, or one `convert`
 * throws. The in-app and MCP tool lists both read an action through this.
 */
export function usableInputSchema<T>(
  entry: {
    tool: { parameters?: unknown };
    unusableInputSchema?: UnusableSchemaError;
  },
  convert: (parameters: any) => T,
): T | UnusableSchemaError {
  if (entry.unusableInputSchema) {
    // Rebuilt, so `instanceof` holds for an action defined by another copy
    // of this module, as a template's actions can be.
    const { path, reason } = entry.unusableInputSchema;
    return new UnusableSchemaError(path, reason);
  }
  try {
    return convert(entry.tool.parameters);
  } catch (error) {
    if (error instanceof UnusableSchemaError) return error;
    throw error;
  }
}
