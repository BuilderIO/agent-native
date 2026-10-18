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

/**
 * Throws for an empty `enum`, which accepts no value. The rewriters type a
 * position from its `enum` values, so one with none would reach the provider
 * with no type, which the pinned provider rules refuse.
 */
export function assertNoEmptyEnum(schema: object): void {
  walkSubschemas(schema as JsonSchema, (node, pointer) => {
    if (!isJsonSchemaObject(node)) return;
    if (!Array.isArray(node.enum) || node.enum.length > 0) return;
    throw new UnusableSchemaError(
      pointer,
      "declares an empty enum, so it accepts no value",
    );
  });
}
