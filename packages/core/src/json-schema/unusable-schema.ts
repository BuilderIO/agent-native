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

/**
 * An input schema whose `$schema` names a dialect the checks do not read:
 * usable but unchecked, and offered stripped and without `$schema`.
 */
export class UninterpretedSchema {
  constructor(
    readonly schema: JsonSchema,
    readonly dialect: unknown,
  ) {}
}

// An empty `allOf` constrains nothing, so it is not on this list.
const CHOICE_KEYWORDS = ["enum", "anyOf", "oneOf"] as const;

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

export function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Throws at the first position that accepts no value: an empty `enum`,
 * `anyOf` or `oneOf`, a `const` or `enum` with no value of the position's
 * `type`, or a `const` its own `enum` does not list. No rewrite keeps that
 * meaning. A position is typed from its `enum` values, so one with none would
 * reach the provider with no type, which the pinned provider rules refuse; the
 * flattener widens a root composition with no branches to an unconstrained
 * object; and stripping drops an `enum` Gemini cannot hold but keeps the
 * position's `type` and `const`, which alone accept a value.
 */
export function assertEveryPositionAcceptsAValue(schema: object): void {
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
    const types = [node.type ?? []].flat();
    const values = node.const === undefined ? node.enum : [node.const];
    const typed = (value: unknown) =>
      types.includes(jsonTypeOf(value)) ||
      (types.includes("integer") && Number.isInteger(value));
    if (types.length > 0 && Array.isArray(values) && !values.some(typed)) {
      throw new UnusableSchemaError(
        pointer,
        "lists no value of its type, so it accepts no value",
      );
    }
    if (node.const === undefined || !Array.isArray(node.enum)) return;
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
 * of `value`. Each own enumerable string-keyed property is read once, through
 * its descriptor, and each of these throws at its position: a getter, which
 * could pass a check as one value and be advertised as another; NaN,
 * Infinity, undefined or a function; a cycle; an object that is not plain;
 * and one whose reads throw.
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

const UNUSABLE_INPUT_SCHEMAS = Symbol.for(
  "@agent-native/core/unusable-input-schemas",
);

// On `globalThis`, because a template's actions can be defined by another copy
// of this module than the one MCP and the in-app agent read them through.
function unusableInputSchemas(): WeakMap<object, InputSchemaVerdict> {
  const state = globalThis as typeof globalThis & {
    [UNUSABLE_INPUT_SCHEMAS]?: WeakMap<object, InputSchemaVerdict>;
  };
  return (state[UNUSABLE_INPUT_SCHEMAS] ??= new WeakMap());
}

type InputSchemaVerdict = UnusableSchemaError | UninterpretedSchema;

/**
 * Records against the `tool` `defineAction` built what its parameters cannot
 * show: why it could not advertise the schema, which stripping can hide, or
 * the dialect it left unread, whose `$schema` it deletes. Only that object
 * carries it: a copy of the action keeps it while it keeps the tool, and the
 * runtime `schema` can be shared by actions that advertise other schemas.
 */
export function recordInputSchemaVerdict(
  tool: object,
  verdict: InputSchemaVerdict,
): void {
  unusableInputSchemas().set(tool, verdict);
}

/** `to`, a tool built from `from`, with any verdict recorded against `from`. */
export function derivedTool<T extends object>(from: object, to: T): T {
  const recorded = unusableInputSchemas().get(from);
  if (recorded) unusableInputSchemas().set(to, recorded);
  return to;
}

/**
 * `convert(entry.tool.parameters)`, with any `$schema` recorded against the
 * tool put back, or the `UnusableSchemaError` that leaves the action out of
 * the MCP and in-app tool lists: the one recorded, or one `convert` throws.
 */
export function usableInputSchema<T>(
  entry: { tool: { parameters?: unknown } },
  convert: (parameters: any) => T,
): T | UnusableSchemaError {
  const recorded = unusableInputSchemas().get(entry.tool);
  // Rebuilt, so `instanceof` holds across copies of this module.
  if (recorded && "reason" in recorded) {
    return new UnusableSchemaError(recorded.path, recorded.reason);
  }
  try {
    return convert(
      recorded
        ? { ...(entry.tool.parameters as object), $schema: recorded.dialect }
        : entry.tool.parameters,
    );
  } catch (error) {
    if (error instanceof UnusableSchemaError) return error;
    throw error;
  }
}
