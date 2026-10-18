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
