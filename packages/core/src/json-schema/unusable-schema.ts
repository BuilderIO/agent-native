import {
  isJsonSchemaObject,
  setOwnProperty,
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

function describeValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (value === undefined) return "undefined";
  if (typeof value === "object" && value !== null) {
    return value.constructor?.name ?? "an object without a prototype";
  }
  return typeof value;
}

/**
 * A plain copy of a JSON value, which the checks and rewrites read in place
 * of `value`. Each own enumerable property is read once, through its
 * descriptor, and anything a JSON round trip would change or drop throws at
 * its position: a getter, which could pass a check as one value and be
 * advertised as another; NaN, Infinity, undefined or a function; a cycle; an
 * object that is not plain; and one whose reads throw.
 */
export function plainJsonSnapshot(value: unknown): unknown {
  const segments: (string | number)[] = [];
  const ancestors = new Set<object>();
  const refuse = (reason: string): never => {
    const path = segments
      .map((key) => `/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`)
      .join("");
    throw new UnusableSchemaError(path, reason);
  };
  const copyOfProperty = (
    key: string | number,
    descriptor: PropertyDescriptor | undefined,
  ): unknown => {
    segments.push(key);
    if (descriptor && !("value" in descriptor)) {
      refuse("is read through a getter");
    }
    const copy = copyOf(descriptor?.value);
    segments.pop();
    return copy;
  };
  const copyOf = (value: unknown): unknown => {
    if (value === null || typeof value === "string") return value;
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object") {
      return refuse(
        `holds ${describeValue(value)}, which JSON cannot represent`,
      );
    }
    if (ancestors.has(value)) return refuse("refers back to itself");
    ancestors.add(value);
    try {
      const copy = copyOfObject(value);
      ancestors.delete(value);
      return copy;
    } catch (error) {
      if (error instanceof UnusableSchemaError) throw error;
      // A proxy's trap can throw where a plain object's read cannot.
      return refuse(
        `could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const copyOfObject = (value: object): unknown[] | JsonSchema => {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!isArray && prototype !== Object.prototype && prototype !== null) {
      refuse(
        `holds a ${describeValue(value)}, which is not a plain JSON object`,
      );
    }
    let copy: unknown[] | JsonSchema;
    if (isArray) {
      copy = [];
      const length = Object.getOwnPropertyDescriptor(value, "length")!.value;
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        copy.push(copyOfProperty(index, descriptor));
      }
    } else {
      copy = {};
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) continue;
        const child = copyOfProperty(key, descriptor);
        // Assigning keeps the copy quick to read, but would make `__proto__`
        // its prototype.
        if (key === "__proto__") setOwnProperty(copy, key, child);
        else copy[key] = child;
      }
    }
    return copy;
  };
  return copyOf(value);
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
